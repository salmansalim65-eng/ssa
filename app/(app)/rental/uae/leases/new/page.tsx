import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { UaeLeaseForm } from "@/components/rental/uae-lease-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

export default async function NewUaeLeasePage() {
  const canCreate = await hasPermission("uae_rent_invoice", "create");
  if (!canCreate) redirect("/rental/uae/leases");

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: assets }, { data: tenants }, { data: companyCurrencies }] = await Promise.all([
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
  ]);

  type RawCurrency = { currencies: { id: string; code: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="New UAE lease"
        description="Create a monthly or yearly rent cycle for a UAE property."
        actions={
          <Button asChild variant="outline">
            <Link href="/rental/uae/leases">
              <ArrowLeftIcon /> Back to list
            </Link>
          </Button>
        }
      />
      <UaeLeaseForm assets={assets ?? []} tenants={tenants ?? []} currencies={currencyOptions} />
    </div>
  );
}
