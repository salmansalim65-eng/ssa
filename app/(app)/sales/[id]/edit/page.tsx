import { notFound, redirect } from "next/navigation";

import { PageNav } from "@/components/ui/page-nav";
import { AssetSaleForm } from "@/components/sales/asset-sale-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function EditAssetSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailHref = `/sales/${id}`;

  const canEdit = await hasPermission("asset_sales", "edit");
  if (!canEdit) redirect(detailHref);

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: accounts }, { data: assetRows }, { data: companyCurrencies }, { data: costCenters }, { data: sale }] =
    await Promise.all([
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
        .schema("assets")
        .from("asset_sales")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle(),
    ]);

  const assetAccounts = ((assetRows as { asset_name: string; account_id: string }[]) ?? []).map((a) => ({
    id: a.account_id,
    account_name: a.asset_name,
  }));

  if (!sale) notFound();

  // The journal entry lives in the `accounting` schema (cross-schema from assets).
  const journalEntriesById = await fetchRefs<{ id: string; status: JournalEntryStatus }>(
    supabase,
    "accounting",
    "journal_entries",
    "status",
    [sale.journal_entry_id],
  );
  const status = journalEntriesById.get(sale.journal_entry_id)?.status ?? "draft";
  if (status !== "draft") redirect(detailHref);

  type RawCurrency = { currencies: { id: string; code: string } | null };
  const saleDay = new Date().toISOString().slice(0, 10);
  const [currencyOptions, { data: lines }] = await Promise.all([
    Promise.all(
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
    ),
    supabase
      .schema("assets")
      .from("asset_sale_lines")
      .select("cost_center_id, fixed_asset_account_id, gross, remarks")
      .eq("sale_id", id)
      .order("line_no"),
  ]);

  return (
    <div className="space-y-4">
      <PageNav backHref="/sales" />
      <h1 className="text-2xl font-semibold tracking-tight">Edit sale asset voucher</h1>
      <AssetSaleForm
        accounts={accounts ?? []}
        assetAccounts={assetAccounts}
        currencies={currencyOptions}
        costCenters={costCenters ?? []}
        voucherId={id}
        initialValues={{
          customerAccountId: sale.customer_account_id,
          saleDate: sale.sale_date,
          paymentTerms: sale.payment_terms ?? "",
          dueDate: sale.due_date ?? "",
          currencyId: sale.currency_id,
          exchangeRate: sale.exchange_rate,
          pakExch: sale.pak_exch,
          narration: sale.narration ?? "",
          lines: (lines ?? []).map((l) => ({
            costCenterId: l.cost_center_id ?? "",
            fixedAssetAccountId: l.fixed_asset_account_id,
            gross: l.gross,
            remarks: l.remarks ?? "",
          })),
        }}
      />
    </div>
  );
}
