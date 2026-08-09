import { Suspense } from "react";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AssetSaleForm } from "@/components/sales/asset-sale-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { mapVoucherCurrencies, type RawCompanyCurrency } from "@/lib/vouchers/currencies";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

export default async function NewAssetSalePage() {
  const canCreate = await hasPermission("asset_sales", "create");
  if (!canCreate) redirect("/sales");

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: accounts }, { data: assetRows }, { data: companyCurrencies }, { data: costCenters }] =
    await Promise.all([
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
      // Real fixed assets/properties from the Asset Register — the Fixed Asset
      // picker offers these only (label = asset name, value = its ledger account).
      supabase
        .schema("assets")
        .from("assets")
        .select("asset_name, account_id")
        .eq("company_id", companyId)
        .not("account_id", "is", null)
        .is("deleted_at", null)
        .order("asset_name"),
      supabase
        .schema("core")
        .from("company_currencies")
        .select("is_base_currency, currencies:currency_id(id, code)")
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

  const assetAccounts = ((assetRows as { asset_name: string; account_id: string }[]) ?? []).map((a) => ({
    id: a.account_id,
    account_name: a.asset_name,
  }));

  const saleDay = new Date().toISOString().slice(0, 10);
  // Base-currency-first so the form defaults to the system base currency.
  const currencyOptions = await mapVoucherCurrencies(
    companyId,
    saleDay,
    companyCurrencies as unknown as RawCompanyCurrency[],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="New Sale Asset Voucher"
        description="Record a property disposal and its accounting entries."
        backHref="/sales"
        actions={
          <Button asChild variant="outline">
            <Link href="/sales">
              <ArrowLeftIcon /> Back to list
            </Link>
          </Button>
        }
      />
      <Suspense>
        <AssetSaleForm
          accounts={accounts ?? []}
          assetAccounts={assetAccounts}
          currencies={currencyOptions}
          costCenters={costCenters ?? []}
        />
      </Suspense>
    </div>
  );
}
