import { redirect } from "next/navigation";

import { PurchaseVoucherForm } from "@/components/purchases/purchase-voucher-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function NewPurchaseVoucherPage() {
  const canCreate = await hasPermission("purchase_voucher", "create");
  if (!canCreate) redirect("/purchases");

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: assets }, { data: suppliers }, { data: accounts }, { data: companyCurrencies }] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("asset_code"),
    supabase
      .schema("assets")
      .from("suppliers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
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
  const currencyOptions = ((companyCurrencies as unknown as RawCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New purchase voucher</h1>
      <PurchaseVoucherForm
        assets={assets ?? []}
        suppliers={suppliers ?? []}
        accounts={accounts ?? []}
        currencies={currencyOptions}
      />
    </div>
  );
}
