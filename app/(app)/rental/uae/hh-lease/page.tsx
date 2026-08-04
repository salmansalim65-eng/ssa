import { redirect } from "next/navigation";

import { HhLeaseForm } from "@/components/rental/hh-lease-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function NewHhLeasePage() {
  const canCreate = await hasPermission("uae_rent_invoice", "create");
  if (!canCreate) redirect("/rental/uae/leases");

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: assets }, { data: tenants }, { data: companyCurrencies }] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name")
      .eq("company_id", companyId)
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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">HH Lease</h1>
        <p className="text-sm text-muted-foreground">
          Enter one tenant and many asset lines at once. Each line is saved as its own UAE lease under a shared
          document number.
        </p>
      </div>
      <HhLeaseForm assets={assets ?? []} tenants={tenants ?? []} currencies={currencyOptions} />
    </div>
  );
}
