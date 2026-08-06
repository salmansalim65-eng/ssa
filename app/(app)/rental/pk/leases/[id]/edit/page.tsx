import { notFound, redirect } from "next/navigation";

import { PkLeaseForm } from "@/components/rental/pk-lease-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function EditPkLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailHref = `/rental/pk/leases/${id}`;

  const canEdit = await hasPermission("pk_rent_invoice", "edit");
  if (!canEdit) redirect(detailHref);

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: assets }, { data: tenants }, { data: companyCurrencies }, { data: lease }] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name")
      .eq("company_id", companyId)
      .eq("country", "PK")
      .is("deleted_at", null)
      .order("asset_code"),
    supabase
      .schema("rental")
      .from("tenants")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("rental")
      .from("pk_leases")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  if (!lease) notFound();

  type RawCurrency = { currencies: { id: string; code: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Edit Pakistan lease</h1>
      <PkLeaseForm
        assets={assets ?? []}
        tenants={tenants ?? []}
        currencies={currencyOptions}
        leaseId={id}
        initialValues={{
          assetId: lease.asset_id,
          tenantId: lease.tenant_id,
          leaseStart: lease.lease_start,
          leaseEnd: lease.lease_end,
          monthlyRent: lease.monthly_rent,
          advanceRent: lease.advance_rent,
          securityDeposit: lease.security_deposit,
          currencyId: lease.currency_id,
          dueDate: lease.due_date ?? "",
          rentMonth: lease.rent_month ?? "",
        }}
      />
    </div>
  );
}
