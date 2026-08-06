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

  const [{ data: assets }, { data: accounts }, { data: companyCurrencies }] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("asset_code"),
    // Postable (non-group) accounts, offered as searchable pickers by name.
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_name")
      .eq("company_id", companyId)
      .eq("is_group", false)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("account_name"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
  ]);

  type RawCurrency = { currencies: { id: string; code: string } | null };
  const saleDay = new Date().toISOString().slice(0, 10);
  const currencyOptions = await Promise.all(
    ((companyCurrencies as unknown as RawCurrency[]) ?? [])
      .filter((cc) => cc.currencies)
      .map(async (cc) => {
        const { data: rate } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
          p_company_id: companyId,
          p_currency_id: cc.currencies!.id,
          p_as_of_date: saleDay,
        });
        return { id: cc.currencies!.id, code: cc.currencies!.code, rate: (rate as number | null) ?? 1 };
      }),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New sale asset voucher</h1>
      <Suspense>
        <AssetSaleForm assets={assets ?? []} accounts={accounts ?? []} currencies={currencyOptions} />
      </Suspense>
    </div>
  );
}
