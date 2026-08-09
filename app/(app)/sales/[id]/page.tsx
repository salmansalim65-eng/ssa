import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CopyVoucherButton } from "@/components/vouchers/copy-voucher-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherDeleteButton } from "@/components/vouchers/voucher-delete-button";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { copyAssetSale, deleteAssetSale, postAssetSale } from "@/features/assets/sale/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { getCurrentCompanyId, getVoucherApproval } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function AssetSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

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

  const [canDelete, canCreate] = await Promise.all([
    hasPermission("asset_sales", "delete"),
    hasPermission("asset_sales", "create"),
  ]);

  const { data: lines } = await supabase
    .schema("assets")
    .from("asset_sale_lines")
    .select("id, line_no, cost_center_id, fixed_asset_account_id, gross, remarks")
    .eq("sale_id", id)
    .order("line_no");

  type LineRow = {
    id: string;
    line_no: number;
    cost_center_id: string | null;
    fixed_asset_account_id: string;
    gross: number;
    remarks: string | null;
  };
  const lineRows = (lines as unknown as LineRow[]) ?? [];

  const saleAsset = (sale as unknown as { assets: { asset_code: string; asset_name: string } | null }).assets;

  const [currenciesById, journalEntriesById, accountsById, costCentersById] = await Promise.all([
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
    fetchRefs<{ id: string; name: string }>(
      supabase,
      "accounting",
      "cost_centers",
      "name",
      lineRows.map((l) => l.cost_center_id).filter((v): v is string => !!v),
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
      <PageHeader
        eyebrow="Sale Asset Voucher"
        title={sale.voucher_no ?? "Draft"}
        backHref="/sales"
        actions={
          <>
            <VoucherStatusBadge status={status} />
            <PrintButton />
            {status === "draft" && canSubmit && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/sales/${sale.id}/edit`}>
                  <PencilIcon /> Edit
                </Link>
              </Button>
            )}
            {canCreate && (
              <CopyVoucherButton
                id={sale.id}
                onCopy={copyAssetSale}
                hrefBase="/sales"
                label="Sale asset voucher"
              />
            )}
            {status === "draft" && canDelete && (
              <VoucherDeleteButton
                id={sale.id}
                onDelete={deleteAssetSale}
                listHref="/sales"
                label="sale asset voucher"
              />
            )}
          </>
        }
      />

      <div className="grid gap-x-8 gap-y-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer (Dr)</p>
          <p className="mt-0.5">{customer}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Asset</p>
          <p className="mt-0.5">{saleAsset ? `${saleAsset.asset_code} — ${saleAsset.asset_name}` : "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</p>
          <p className="mt-0.5">{formatDate(sale.sale_date)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Currency</p>
          <p className="mt-0.5">
            {currencyCode} @ {formatRate(sale.exchange_rate)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pak. Exch</p>
          <p className="mt-0.5">{sale.pak_exch.toLocaleString()}</p>
        </div>
        {sale.narration && (
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Narration</p>
            <p className="mt-0.5">{sale.narration}</p>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table className="min-w-[850px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">Sno</TableHead>
              <TableHead>Cost Center</TableHead>
              <TableHead>Fixed Asset (Property) (Cr)</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead>Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineRows.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-muted-foreground">{l.line_no}</TableCell>
                <TableCell>{l.cost_center_id ? costCentersById.get(l.cost_center_id)?.name ?? "—" : "—"}</TableCell>
                <TableCell className="font-medium">{accountsById.get(l.fixed_asset_account_id)?.account_name ?? "—"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(l.gross)}</TableCell>
                <TableCell>{l.remarks ?? "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="text-right font-medium">
                Total Value
              </TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {formatMoney(sale.total_value)} {currencyCode}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="print:hidden">
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
    </div>
  );
}
