import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { loadReportCountries } from "@/lib/reports/countries";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { healStrayAssetAccounts } from "@/features/accounting/chart-of-accounts/actions";
import { AccountTree, type AccountRow, type LinkedAssetFields } from "./account-tree";

export default async function ChartOfAccountsPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  // Heal any legacy stray duplicate asset GL accounts before rendering the tree
  // (idempotent no-op once the data is clean; no-ops for non-editors).
  await healStrayAssetAccounts();

  const [
    { data: accounts },
    { data: companyCurrencies },
    { data: ledger },
    { data: linkedAssets },
    canCreate,
    canEdit,
    canDelete,
    canCreateGroup,
    canEditGroup,
    canDeleteGroup,
  ] = await Promise.all([
      supabase
        .schema("accounting")
        .from("chart_of_accounts")
        .select("id, account_code, account_name, parent_id, account_type, currency_id, opening_balance, is_group, is_active, is_cash, is_bank, is_tenant_group, linked_asset_id, sort_order, id_number, contact_person, phone, email, country, default_cost_center_id")
        .eq("company_id", companyId)
        .is("deleted_at", null),
      supabase
        .schema("core")
        .from("company_currencies")
        .select("is_base_currency, currencies:currency_id(id, code)")
        .eq("company_id", companyId)
        .eq("is_active", true),
      supabase
        .schema("reporting")
        .from("v_ledger_entries")
        .select("account_id, debit_amount, credit_amount, doc_debit_amount, doc_credit_amount, currency_code")
        .eq("company_id", companyId),
      supabase
        .schema("assets")
        .from("assets")
        .select(
          "id, account_id, is_rental, property_type, status, city, address, owner, official_owner, purchase_date, area_sqft, area_unit, purchase_value, current_value, title_deed_value, service_charges_rate, property_tax, other_charges, estimated_rent, notes",
        )
        .eq("company_id", companyId)
        .is("deleted_at", null),
      hasPermission("chart_of_accounts", "create"),
      hasPermission("chart_of_accounts", "edit"),
      hasPermission("chart_of_accounts", "delete"),
      // A group account shapes the chart, so it is governed by its own module —
      // someone may be allowed to add accounts but not to restructure the chart.
      hasPermission("account_groups", "create"),
      hasPermission("account_groups", "edit"),
      hasPermission("account_groups", "delete"),
    ]);

  // Property fields of each asset, keyed by asset id AND by the account it links
  // to, to prefill the CoA Property details section when editing a linked
  // property account. The by-account key is the fallback for properties whose
  // chart_of_accounts.linked_asset_id was never populated (the asset links back
  // via assets.account_id instead) — otherwise the details load blank on reopen.
  const assetFieldsById: Record<string, LinkedAssetFields> = {};
  const assetFieldsByAccountId: Record<string, LinkedAssetFields> = {};
  for (const a of (linkedAssets as unknown as (LinkedAssetFields & { id: string; account_id: string | null })[]) ??
    []) {
    const fields: LinkedAssetFields = {
      is_rental: a.is_rental,
      property_type: a.property_type,
      status: a.status,
      city: a.city,
      address: a.address,
      owner: a.owner,
      official_owner: a.official_owner,
      purchase_date: a.purchase_date,
      area_sqft: a.area_sqft,
      area_unit: a.area_unit,
      purchase_value: a.purchase_value,
      current_value: a.current_value,
      title_deed_value: a.title_deed_value,
      service_charges_rate: a.service_charges_rate,
      property_tax: a.property_tax,
      other_charges: a.other_charges,
      estimated_rent: a.estimated_rent,
      notes: a.notes,
    };
    assetFieldsById[a.id] = fields;
    if (a.account_id) assetFieldsByAccountId[a.account_id] = fields;
  }

  type RawCompanyCurrencyCode = { is_base_currency: boolean; currencies: { id: string; code: string } | null };
  const baseCurrencyCode =
    ((companyCurrencies as unknown as RawCompanyCurrencyCode[]) ?? []).find((c) => c.is_base_currency)?.currencies
      ?.code ?? "";

  // Current balance per posting account, both in base currency and in the
  // currency the account was actually posted in. The row already labels itself
  // with the account's currency, so an AED property that took AED 300,000 must
  // read 300,000 — not the 306,000 its base translation comes to. Where an
  // account mixes currencies there is no single own-currency figure, and base is
  // the only honest total. Group rows roll these up on the client.
  const netById = new Map<string, { base: number; doc: number; codes: Set<string> }>();
  for (const l of ledger ?? []) {
    const k = l.account_id as string;
    if (!k) continue;
    const n = netById.get(k) ?? { base: 0, doc: 0, codes: new Set<string>() };
    n.base += Number(l.debit_amount) - Number(l.credit_amount);
    n.doc += Number(l.doc_debit_amount ?? 0) - Number(l.doc_credit_amount ?? 0);
    if (l.currency_code) n.codes.add(l.currency_code as string);
    netById.set(k, n);
  }

  type RawAccount = {
    id: string;
    account_code: string;
    account_name: string;
    parent_id: string | null;
    account_type: AccountRow["account_type"];
    currency_id: string | null;
    opening_balance: number;
    is_group: boolean;
    is_active: boolean;
    is_cash: boolean;
    is_bank: boolean;
    is_tenant_group: boolean;
    linked_asset_id: string | null;
    sort_order: number;
    id_number: string | null;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    country: string | null;
    default_cost_center_id: string | null;
  };

  const rows = (accounts as unknown as RawAccount[]) ?? [];
  const currenciesById = await fetchRefs<{ id: string; code: string }>(
    supabase,
    "core",
    "currencies",
    "code",
    rows.map((r) => r.currency_id),
  );

  // Where an opening balance's other side may go: the company's posting equity
  // and liability accounts. Alongside them, the counter account each account's
  // existing opening balance already used, so editing shows what is in force.
  const [{ data: contraRows }, { data: obVouchers }] = await Promise.all([
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name")
      .eq("company_id", companyId)
      .in("account_type", ["equity", "liability"])
      .eq("is_group", false)
      .is("deleted_at", null)
      .order("account_code"),
    supabase
      .schema("accounting")
      .from("opening_balance_vouchers")
      .select("contra_account_id, opening_balance_voucher_lines(account_id)")
      .eq("company_id", companyId),
  ]);
  const contraAccounts = (contraRows ?? []).map((a) => ({
    id: a.id as string,
    account_code: a.account_code as string,
    account_name: a.account_name as string,
  }));
  type RawObVoucher = {
    contra_account_id: string | null;
    opening_balance_voucher_lines: { account_id: string }[] | null;
  };
  const contraByAccount = new Map<string, string>();
  for (const v of (obVouchers as unknown as RawObVoucher[]) ?? []) {
    if (!v.contra_account_id) continue;
    for (const l of v.opening_balance_voucher_lines ?? []) {
      contraByAccount.set(l.account_id, v.contra_account_id);
    }
  }

  const accountRows: AccountRow[] = rows.map((a) => ({
    id: a.id,
    account_code: a.account_code,
    account_name: a.account_name,
    parent_id: a.parent_id,
    account_type: a.account_type,
    currency_id: a.currency_id,
    currency_code: a.currency_id ? currenciesById.get(a.currency_id)?.code ?? null : null,
    opening_balance: a.opening_balance,
    is_group: a.is_group,
    is_active: a.is_active,
    is_cash: a.is_cash,
    is_bank: a.is_bank,
    is_tenant_group: a.is_tenant_group,
    linked_asset_id: a.linked_asset_id,
    sort_order: a.sort_order,
    balance: (() => {
      const n = netById.get(a.id);
      if (!n) return 0;
      return n.codes.size === 1 ? n.doc : n.base;
    })(),
    base_balance: netById.get(a.id)?.base ?? 0,
    // The currency the balance above is stated in — the account's own when every
    // posting shares one, else the base currency.
    balance_currency: (() => {
      const n = netById.get(a.id);
      if (n && n.codes.size === 1) return [...n.codes][0];
      return baseCurrencyCode;
    })(),
    id_number: a.id_number,
    contact_person: a.contact_person,
    phone: a.phone,
    email: a.email,
    country: a.country,
    default_cost_center_id: a.default_cost_center_id,
    opening_balance_contra_id: contraByAccount.get(a.id) ?? null,
  }));

  type RawCompanyCurrency = { is_base_currency: boolean; currencies: { id: string; code: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCompanyCurrency[]) ?? [])
    .filter((cc) => !cc.is_base_currency && cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  const countries = await loadReportCountries(companyId);

  // Cost centres an account can be tied to, so its postings reach the
  // cost-centre reports even when a voucher was raised without one.
  const { data: costCentreRows } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    // Postings land on a leaf, not on a group heading; a report filtered to the
    // group rolls its children up anyway.
    .eq("is_group", false)
    .is("deleted_at", null)
    .order("name");
  const costCentres = (costCentreRows ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));

  return (
    <AccountTree
      accounts={accountRows}
      currencies={currencyOptions}
      countries={countries}
      costCentres={costCentres}
      contraAccounts={contraAccounts}
      baseCurrencyCode={baseCurrencyCode}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      canCreateGroup={canCreateGroup}
      canEditGroup={canEditGroup}
      canDeleteGroup={canDeleteGroup}
      assetFieldsById={assetFieldsById}
      assetFieldsByAccountId={assetFieldsByAccountId}
    />
  );
}
