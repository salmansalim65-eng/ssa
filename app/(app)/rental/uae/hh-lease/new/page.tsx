import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { HhLeaseForm } from "@/components/rental/hh-lease-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadTenantAccounts } from "@/lib/rental/tenant-accounts";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

// Expense accounts a HH lease can charge: the non-group children of the Chart-
// of-Accounts group named "Rental Expenses". Empty when that group (or any child
// account) hasn't been set up yet.
async function loadRentalExpenseAccounts(companyId: string) {
  const supabase = await createClient();
  const { data: group } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_group", true)
    .ilike("account_name", "Rental Expenses")
    .is("deleted_at", null)
    .maybeSingle();
  if (!group) return [];
  const { data: accounts } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_code, account_name")
    .eq("company_id", companyId)
    .eq("parent_id", group.id)
    .eq("is_group", false)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("account_code");
  return accounts ?? [];
}

export default async function NewHhLeasePage() {
  const canCreate = await hasPermission("uae_rent_invoice", "create");
  if (!canCreate) redirect("/rental/uae/hh-lease");

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: assets }, tenants, { data: companyCurrencies }, expenseAccounts] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name")
      .eq("company_id", companyId)
      .eq("country", "AE")
      .eq("is_rental", true)
      .is("deleted_at", null)
      .order("asset_code"),
    // HH tenants come from the Chart of Accounts tenant group (country = AE).
    loadTenantAccounts(companyId, "AE"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    loadRentalExpenseAccounts(companyId),
  ]);

  type RawCurrency = { is_base_currency: boolean; currencies: { id: string; code: string } | null };
  const rawCurrencies = ((companyCurrencies as unknown as RawCurrency[]) ?? []).filter((cc) => cc.currencies);
  const currencyOptions = rawCurrencies.map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));
  // HH leases are UAE leases — default to AED; fall back to base currency.
  const defaultCurrencyId =
    rawCurrencies.find((cc) => cc.currencies!.code === "AED")?.currencies!.id ??
    rawCurrencies.find((cc) => cc.is_base_currency)?.currencies!.id;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="New HH Lease"
        description="Enter one tenant and many asset lines at once. Each line is saved as its own UAE lease under a shared document number."
        backHref="/rental/uae/hh-lease"
      />
      <HhLeaseForm
        assets={assets ?? []}
        tenants={tenants ?? []}
        currencies={currencyOptions}
        defaultCurrencyId={defaultCurrencyId}
        expenseAccounts={expenseAccounts}
      />
    </div>
  );
}
