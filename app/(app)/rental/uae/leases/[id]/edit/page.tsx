import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { UaeLeaseForm } from "@/components/rental/uae-lease-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

export default async function EditUaeLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailHref = `/rental/uae/leases/${id}`;

  const canEdit = await hasPermission("uae_rent_invoice", "edit");
  if (!canEdit) redirect(detailHref);

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: assets }, { data: tenants }, { data: companyCurrencies }, { data: lease }] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name")
      .eq("company_id", companyId)
      .eq("country", "AE")
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
      .from("uae_leases")
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="Edit UAE lease"
        description="Update the terms of this UAE lease."
        backHref="/rental/uae/leases"
        actions={
          <Button asChild variant="outline">
            <Link href={detailHref}>
              <ArrowLeftIcon /> Back to lease
            </Link>
          </Button>
        }
      />
      <UaeLeaseForm
        assets={assets ?? []}
        tenants={tenants ?? []}
        currencies={currencyOptions}
        leaseId={id}
        initialValues={{
          assetId: lease.asset_id,
          tenantId: lease.tenant_id,
          leaseStart: lease.lease_start,
          leaseEnd: lease.lease_end,
          rentalAmount: lease.rental_amount,
          rentCycle: lease.rent_cycle as "monthly" | "yearly",
          securityDeposit: lease.security_deposit,
          currencyId: lease.currency_id,
          dueDate: lease.due_date ?? "",
          rentMonth: lease.rent_month ?? "",
        }}
      />
    </div>
  );
}
