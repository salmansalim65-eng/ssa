import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PurchaseVoucherForm } from "@/components/purchases/purchase-voucher-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { mapVoucherCurrencies, type RawCompanyCurrency } from "@/lib/vouchers/currencies";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

export default async function NewPurchaseVoucherPage() {
  const canCreate = await hasPermission("purchase_voucher", "create");
  if (!canCreate) redirect("/purchases");

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

  const today = new Date().toISOString().slice(0, 10);
  // Base-currency-first so the form defaults to the system base currency.
  const currencyOptions = await mapVoucherCurrencies(
    companyId,
    today,
    companyCurrencies as unknown as RawCompanyCurrency[],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="New Purchase Voucher"
        description="Record a property acquisition and its accounting entries."
        backHref="/purchases"
        actions={
          <Button asChild variant="outline">
            <Link href="/purchases">
              <ArrowLeftIcon /> Back to list
            </Link>
          </Button>
        }
      />
      <PurchaseVoucherForm accounts={accounts ?? []} currencies={currencyOptions} costCenters={costCenters ?? []} />
    </div>
  );
}
