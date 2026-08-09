import { notFound, redirect } from "next/navigation";

import { PageNav } from "@/components/ui/page-nav";
import { PurchaseVoucherForm } from "@/components/purchases/purchase-voucher-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function EditPurchaseVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailHref = `/purchases/${id}`;

  const canEdit = await hasPermission("purchase_voucher", "edit");
  if (!canEdit) redirect(detailHref);

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: accounts }, { data: companyCurrencies }, { data: costCenters }, { data: voucher }] = await Promise.all([
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
    supabase
      .schema("accounting")
      .from("purchase_vouchers")
      .select("*, journal_entries:journal_entry_id(status)")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
  ]);

  if (!voucher) notFound();
  const status =
    (voucher as unknown as { journal_entries: { status: JournalEntryStatus } | null }).journal_entries?.status ??
    "draft";
  if (status !== "draft") redirect(detailHref);

  type RawCurrency = { currencies: { id: string; code: string } | null };
  const today = new Date().toISOString().slice(0, 10);
  const [currencyOptions, { data: lines }] = await Promise.all([
    Promise.all(
      ((companyCurrencies as unknown as RawCurrency[]) ?? [])
        .filter((cc) => cc.currencies)
        .map(async (cc) => {
          const { data: rate } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
            p_company_id: companyId,
            p_currency_id: cc.currencies!.id,
            p_as_of_date: today,
          });
          return { id: cc.currencies!.id, code: cc.currencies!.code, rate: (rate as number | null) ?? 1 };
        }),
    ),
    supabase
      .schema("accounting")
      .from("purchase_voucher_lines")
      .select("cost_center_id, fixed_asset_account_id, gross, due_date, installment_month, remarks")
      .eq("voucher_id", id)
      .order("line_no"),
  ]);

  const v = voucher as unknown as Record<string, unknown>;

  return (
    <div className="space-y-4">
      <PageNav backHref="/purchases" />
      <h1 className="text-2xl font-semibold tracking-tight">Edit purchase voucher</h1>
      <PurchaseVoucherForm
        accounts={accounts ?? []}
        currencies={currencyOptions}
        costCenters={costCenters ?? []}
        voucherId={id}
        initialValues={{
          vendorAccountId: v.vendor_account_id as string,
          purchaseDate: v.purchase_date as string,
          currencyId: v.currency_id as string,
          exchangeRate: v.exchange_rate as number,
          narration: (v.narration as string | null) ?? "",
          paymentTerms: (v.payment_terms as string | null) ?? "",
          sharePercentage: v.share_percentage as number,
          lines: (lines ?? []).map((l) => ({
            costCenterId: l.cost_center_id ?? "",
            fixedAssetAccountId: l.fixed_asset_account_id,
            gross: l.gross,
            dueDate: l.due_date ?? "",
            installmentMonth: l.installment_month ?? "",
            remarks: l.remarks ?? "",
          })),
        }}
      />
    </div>
  );
}
