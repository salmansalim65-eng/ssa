import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { HhLeaseForm } from "@/components/rental/hh-lease-form";
import { createUaeRentInvoice } from "@/features/rental/hh-leases/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadTenantAccounts } from "@/lib/rental/tenant-accounts";
import { loadRentalExpenseAccounts } from "@/lib/rental/rental-expense-accounts";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

export default async function NewUaeRentInvoicePage() {
  const canCreate = await hasPermission("uae_rent_invoice", "create");
  if (!canCreate) redirect("/rental/uae/leases");

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
  const defaultCurrencyId =
    rawCurrencies.find((cc) => cc.currencies!.code === "AED")?.currencies!.id ??
    rawCurrencies.find((cc) => cc.is_base_currency)?.currencies!.id;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="New UAE Rent Invoice"
        description="Enter one tenant and one or many properties at once. It posts as a single rent invoice with one accounting entry for the whole voucher."
        backHref="/rental/uae/leases"
      />
      <HhLeaseForm
        assets={assets ?? []}
        tenants={tenants ?? []}
        currencies={currencyOptions}
        defaultCurrencyId={defaultCurrencyId}
        expenseAccounts={expenseAccounts}
        createAction={createUaeRentInvoice}
        docLabel="UAE Rent Invoice"
        redirectHref="/rental/uae/leases"
        managementPct={0.05}
      />
    </div>
  );
}
