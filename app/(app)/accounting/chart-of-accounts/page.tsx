import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { loadReportCountries } from "@/lib/reports/countries";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { AccountTree, type AccountRow } from "./account-tree";

export default async function ChartOfAccountsPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: accounts }, { data: companyCurrencies }, canCreate, canEdit, canDelete] =
    await Promise.all([
      supabase
        .schema("accounting")
        .from("chart_of_accounts")
        .select("id, account_code, account_name, parent_id, account_type, currency_id, opening_balance, is_group, is_active, is_cash, is_bank, is_tenant_group, id_number, phone, email, country")
        .eq("company_id", companyId)
        .is("deleted_at", null),
      supabase
        .schema("core")
        .from("company_currencies")
        .select("is_base_currency, currencies:currency_id(id, code)")
        .eq("company_id", companyId)
        .eq("is_active", true),
      hasPermission("chart_of_accounts", "create"),
      hasPermission("chart_of_accounts", "edit"),
      hasPermission("chart_of_accounts", "delete"),
    ]);

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
    id_number: string | null;
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
    id_number: a.id_number,
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
    />
  );
}
