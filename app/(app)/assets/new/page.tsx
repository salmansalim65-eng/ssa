import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { NewAssetForm } from "./new-asset-form";

export default async function NewAssetPage() {
  const canCreate = await hasPermission("assets", "create");
  if (!canCreate) redirect("/assets");

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: companyCurrencies }, { data: costCenters }, { data: countries }, canAddCountry] =
    await Promise.all([
      supabase
        .schema("core")
        .from("company_currencies")
        .select("currencies:currency_id(id, code, symbol)")
        .eq("company_id", companyId)
        .eq("is_active", true),
      supabase
        .schema("accounting")
        .from("cost_centers")
        .select("id, code, name")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("code"),
      supabase
        .schema("core")
        .from("countries")
        .select("code, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      hasPermission("countries", "create"),
    ]);

  type RawCompanyCurrency = { currencies: { id: string; code: string; symbol: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCompanyCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code, symbol: cc.currencies!.symbol }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="New Asset"
        description="Register a rental property or other asset."
        backHref="/assets"
      />
      <NewAssetForm
        currencies={currencyOptions}
        costCenters={costCenters ?? []}
        countries={countries ?? []}
        canAddCountry={canAddCountry}
      />
    </div>
  );
}
