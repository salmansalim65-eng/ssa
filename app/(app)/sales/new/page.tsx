import { Suspense } from "react";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AssetSaleForm } from "@/components/sales/asset-sale-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

export default async function NewAssetSalePage() {
  const canCreate = await hasPermission("asset_sales", "create");
  if (!canCreate) redirect("/sales");

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: accounts }, { data: companyCurrencies }, { data: costCenters }] = await Promise.all([
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
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="New Sale Asset Voucher"
        description="Record a property disposal and its accounting entries."
        actions={
          <Button asChild variant="outline">
            <Link href="/sales">
              <ArrowLeftIcon /> Back to list
            </Link>
          </Button>
        }
      />
      <Suspense>
        <AssetSaleForm accounts={accounts ?? []} currencies={currencyOptions} costCenters={costCenters ?? []} />
      </Suspense>
    </div>
  );
}
