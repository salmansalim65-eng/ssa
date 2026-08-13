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
  ] = await Promise.all([
      supabase
        .schema("accounting")
        .from("chart_of_accounts")
        .select("id, account_code, account_name, parent_id, account_type, currency_id, opening_balance, is_group, is_active, is_cash, is_bank, is_tenant_group, linked_asset_id, sort_order, id_number, contact_person, phone, email, country")
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
        .select("account_id, debit_amount, credit_amount")
        .eq("company_id", companyId),
      supabase
        .schema("assets")
        .from("assets")
        .select(
          "id, is_rental, property_type, status, city, address, owner, official_owner, purchase_date, area_sqft, area_unit, purchase_value, current_value, title_deed_value, service_charges_rate, other_charges, estimated_rent, notes",
        )
        .eq("company_id", companyId)
        .is("deleted_at", null),
      hasPermission("chart_of_accounts", "create"),
      hasPermission("chart_of_accounts", "edit"),
      hasPermission("chart_of_accounts", "delete"),
    ]);

  // Property fields of each asset, keyed by id, to prefill the CoA Property
  // details section when editing a linked property account.
  const assetFieldsById: Record<string, LinkedAssetFields> = {};
  for (const a of (linkedAssets as unknown as (LinkedAssetFields & { id: string })[]) ?? []) {
    assetFieldsById[a.id] = {
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
      other_charges: a.other_charges,
      estimated_rent: a.estimated_rent,
      notes: a.notes,
    };
  }

  // Current balance per posting account, net in the base currency. Group rows
  // roll these up on the client from their descendants.
  const balanceById = new Map<string, number>();
  for (const l of ledger ?? []) {
    const k = l.account_id as string;
    if (!k) continue;
    balanceById.set(k, (balanceById.get(k) ?? 0) + Number(l.debit_amount) - Number(l.credit_amount));
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
  };

  const rows = (accounts as unknown as RawAccount[]) ?? [];
  const currenciesById = await fetchRefs<{ id: string; code: string }>(
    supabase,
    "core",
    "currencies",
    "code",
    rows.map((r) => r.currency_id),
  );

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
    balance: balanceById.get(a.id) ?? 0,
    id_number: a.id_number,
    contact_person: a.contact_person,
    phone: a.phone,
    email: a.email,
    country: a.country,
  }));

  type RawCompanyCurrency = { is_base_currency: boolean; currencies: { id: string; code: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCompanyCurrency[]) ?? [])
    .filter((cc) => !cc.is_base_currency && cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  const countries = await loadReportCountries(companyId);

  return (
    <AccountTree
      accounts={accountRows}
      currencies={currencyOptions}
      countries={countries}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      assetFieldsById={assetFieldsById}
    />
  );
}
