import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { UaeLeaseForm } from "@/components/rental/uae-lease-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { accountIdForTenant, loadTenantAccounts } from "@/lib/rental/tenant-accounts";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

export default async function EditUaeLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailHref = `/rental/uae/leases/${id}`;

  const canEdit = await hasPermission("uae_rent_invoice", "edit");
  if (!canEdit) redirect(detailHref);

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: assets }, tenants, { data: companyCurrencies }, { data: lease }] = await Promise.all([
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
      .select("currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  if (!lease) notFound();

  // The tenant dropdown lists COA account ids; map the lease's stored tenant
  // back to its account id so it preselects.
  const tenantAccountId = await accountIdForTenant(companyId, lease.tenant_id);

  type RawCurrency = { currencies: { id: string; code: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="Edit UAE lease"
        description="Update the terms of this UAE lease."
        backHref="/rental/uae/leases"
      />
      <UaeLeaseForm
        assets={assets ?? []}
        tenants={tenants}
        currencies={currencyOptions}
        leaseId={id}
        initialValues={{
          assetId: lease.asset_id,
          tenantId: tenantAccountId,
          leaseStart: lease.lease_start,
          leaseEnd: lease.lease_end,
          rentalAmount: lease.rental_amount,
          rentCycle: lease.rent_cycle as "monthly" | "yearly",
          securityDeposit: lease.security_deposit,
          currencyId: lease.currency_id,
          dueDate: lease.due_date ?? "",
          voucherDate: lease.voucher_date ?? "",
        }}
      />
    </div>
  );
}
