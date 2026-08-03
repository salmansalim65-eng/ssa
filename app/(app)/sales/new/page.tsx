import { Suspense } from "react";

import { redirect } from "next/navigation";

import { AssetSaleForm } from "@/components/sales/asset-sale-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function NewAssetSalePage() {
  const canCreate = await hasPermission("asset_sales", "create");
  if (!canCreate) redirect("/sales");

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: assets }, { data: companyCurrencies }] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name, current_value")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("asset_code"),
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
      <h1 className="text-2xl font-semibold tracking-tight">New asset sale</h1>
      <Suspense>
        <AssetSaleForm assets={assets ?? []} currencies={currencyOptions} />
      </Suspense>
    </div>
  );
}
