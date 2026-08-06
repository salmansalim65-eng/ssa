import { notFound } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { postAssetSale } from "@/features/assets/sale/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { getVoucherApproval } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function AssetSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: sale }, canSubmit, canApprove, canReject, canPost] = await Promise.all([
    supabase
      .schema("assets")
      .from("asset_sales")
      .select("*, assets:asset_id(asset_code, asset_name)")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("asset_sales", "edit"),
    hasPermission("asset_sales", "approve"),
    hasPermission("asset_sales", "reject"),
    hasPermission("asset_sales", "post"),
  ]);

  if (!sale) notFound();

  const { data: lines } = await supabase
    .schema("assets")
    .from("asset_sale_lines")
    .select("id, line_no, fixed_asset_account_id, gross, remarks")
    .eq("sale_id", id)
    .order("line_no");

  type LineRow = { id: string; line_no: number; fixed_asset_account_id: string; gross: number; remarks: string | null };
  const lineRows = (lines as unknown as LineRow[]) ?? [];

  const saleAsset = (sale as unknown as { assets: { asset_code: string; asset_name: string } | null }).assets;

  const [currenciesById, journalEntriesById, accountsById] = await Promise.all([
    fetchRefs<{ id: string; code: string }>(supabase, "core", "currencies", "code", [sale.currency_id]),
    fetchRefs<{ id: string; status: JournalEntryStatus }>(
      supabase,
      "accounting",
      "journal_entries",
      "status",
      [sale.journal_entry_id],
    ),
    fetchRefs<{ id: string; account_name: string }>(
      supabase,
      "accounting",
      "chart_of_accounts",
      "account_name",
      [sale.customer_account_id, ...lineRows.map((l) => l.fixed_asset_account_id)],
    ),
  ]);

  const status = journalEntriesById.get(sale.journal_entry_id)?.status ?? "draft";
  const currencyCode = currenciesById.get(sale.currency_id)?.code ?? "";
  const customer = sale.customer_account_id
    ? accountsById.get(sale.customer_account_id)?.account_name ?? "—"
    : "—";

  const approval = await getVoucherApproval("asset_sales", id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sale Asset Voucher</h1>
          <p className="font-mono text-sm text-muted-foreground">{sale.voucher_no ?? "Draft"}</p>
        </div>
        <VoucherStatusBadge status={status} />
      </div>

      <div className="grid gap-x-8 gap-y-2 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Customer (Dr)</p>
          <p>{customer}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Asset</p>
          <p>{saleAsset ? `${saleAsset.asset_code} — ${saleAsset.asset_name}` : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date</p>
          <p>{sale.sale_date}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Currency</p>
          <p>
            {currencyCode} @ {sale.exchange_rate.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Pak. Exch</p>
          <p>{sale.pak_exch.toLocaleString()}</p>
        </div>
        {sale.narration && (
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs text-muted-foreground">Narration</p>
            <p>{sale.narration}</p>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Sno</TableHead>
              <TableHead>Fixed Asset (Property) (Cr)</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead>Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineRows.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-muted-foreground">{l.line_no}</TableCell>
                <TableCell>{accountsById.get(l.fixed_asset_account_id)?.account_name ?? "—"}</TableCell>
                <TableCell className="text-right">{l.gross.toLocaleString()}</TableCell>
                <TableCell>{l.remarks ?? "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={2} className="text-right font-medium">
                Total Value
              </TableCell>
              <TableCell className="text-right font-medium">
                {sale.total_value.toLocaleString()} {currencyCode}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <VoucherActions
        status={status}
        voucherType="asset_sales"
        voucherId={sale.id}
        journalEntryId={sale.journal_entry_id}
        amount={sale.total_value}
        approvalId={approval?.id ?? null}
        canSubmit={canSubmit}
        canApprove={canApprove}
        canReject={canReject}
        canPost={canPost}
        onPost={postAssetSale}
      />
    </div>
  );
}
