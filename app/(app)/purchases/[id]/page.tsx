import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AttachmentList, type AttachmentItem } from "@/components/attachments/attachment-list";
import { CopyVoucherButton } from "@/components/vouchers/copy-voucher-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { ReversePostedButton } from "@/components/vouchers/reverse-posted-button";
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherDeleteButton } from "@/components/vouchers/voucher-delete-button";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import {
  copyPurchaseVoucher,
  deletePurchaseVoucher,
  postPurchaseVoucher,
} from "@/features/accounting/purchase-voucher/actions";
import { getSignedUrl } from "@/features/attachments/actions";
import { hasPermission, isCurrentUserAdmin } from "@/lib/auth/permissions";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { getCurrentCompanyId, getVoucherApproval } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function PurchaseVoucherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: voucher }, canSubmit, canApprove, canReject, canPost] = await Promise.all([
    supabase
      .schema("accounting")
      .from("purchase_vouchers")
      .select("*, journal_entries:journal_entry_id(status)")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("purchase_voucher", "edit"),
    hasPermission("purchase_voucher", "approve"),
    hasPermission("purchase_voucher", "reject"),
    hasPermission("purchase_voucher", "post"),
  ]);

  if (!voucher) notFound();

  const [canDelete, canCreate, isAdmin] = await Promise.all([
    hasPermission("purchase_voucher", "delete"),
    hasPermission("purchase_voucher", "create"),
    isCurrentUserAdmin(),
  ]);

  const { data: lines } = await supabase
    .schema("accounting")
    .from("purchase_voucher_lines")
    .select("id, line_no, cost_center_id, fixed_asset_account_id, gross, due_date, installment_month, remarks")
    .eq("voucher_id", id)
    .order("line_no");

  type LineRow = {
    id: string;
    line_no: number;
    cost_center_id: string | null;
    fixed_asset_account_id: string;
    gross: number;
    due_date: string | null;
    installment_month: string | null;
    remarks: string | null;
  };
  const lineRows = (lines as unknown as LineRow[]) ?? [];

  const [currenciesById, accountsById, costCentersById] = await Promise.all([
    fetchRefs<{ id: string; code: string }>(supabase, "core", "currencies", "code", [voucher.currency_id]),
    fetchRefs<{ id: string; account_name: string }>(
      supabase,
      "accounting",
      "chart_of_accounts",
      "account_name",
      [voucher.vendor_account_id, ...lineRows.map((l) => l.fixed_asset_account_id)],
    ),
    fetchRefs<{ id: string; name: string }>(
      supabase,
      "accounting",
      "cost_centers",
      "name",
      lineRows.map((l) => l.cost_center_id).filter((v): v is string => !!v),
    ),
  ]);

  const status =
    (voucher as unknown as { journal_entries: { status: JournalEntryStatus } | null }).journal_entries?.status ??
    "draft";
  const currencyCode = currenciesById.get(voucher.currency_id)?.code ?? "";
  const vendorAccount = voucher.vendor_account_id
    ? accountsById.get(voucher.vendor_account_id)?.account_name ?? "—"
    : "—";

  const [approval, { data: attachments }] = await Promise.all([
    getVoucherApproval("purchase_voucher", id),
    supabase
      .schema("core")
      .from("attachments")
      .select("id, file_name, path, bucket")
      .eq("entity_type", "purchase_voucher")
      .eq("entity_id", id)
      .is("deleted_at", null),
  ]);

  const attachmentItems: AttachmentItem[] = await Promise.all(
    (attachments ?? []).map(async (a) => ({
      id: a.id,
      fileName: a.file_name,
      url: await getSignedUrl(a.bucket, a.path),
    })),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchase Voucher"
        title={voucher.voucher_no ?? "Draft"}
        backHref="/purchases"
        actions={
          <>
            <VoucherStatusBadge status={status} />
            <PrintButton />
            {status === "draft" && canSubmit && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/purchases/${voucher.id}/edit`}>
                  <PencilIcon /> Edit
                </Link>
              </Button>
            )}
            {canCreate && (
              <CopyVoucherButton
                id={voucher.id}
                onCopy={copyPurchaseVoucher}
                hrefBase="/purchases"
                label="Purchase voucher"
              />
            )}
            {status === "draft" && canDelete && (
              <VoucherDeleteButton
                id={voucher.id}
                onDelete={deletePurchaseVoucher}
                listHref="/purchases"
                label="purchase voucher"
              />
            )}
            {isAdmin && status === "posted" && (
              <ReversePostedButton
                journalEntryId={voucher.journal_entry_id}
                revalidate={["/purchases", `/purchases/${voucher.id}`]}
                redirectTo="/purchases"
              />
            )}
          </>
        }
      />

      <div className="grid gap-x-8 gap-y-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendor (Cr)</p>
          <p className="mt-0.5">{vendorAccount}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</p>
          <p className="mt-0.5">{formatDate(voucher.purchase_date)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Currency</p>
          <p className="mt-0.5">
            {currencyCode} @ {formatRate(voucher.exchange_rate)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment terms</p>
          <p className="mt-0.5">{voucher.payment_terms ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Share %</p>
          <p className="mt-0.5">{voucher.share_percentage.toLocaleString()}</p>
        </div>
        {voucher.narration && (
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Narration</p>
            <p className="mt-0.5">{voucher.narration}</p>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table className="min-w-[1000px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">Sno</TableHead>
              <TableHead>Cost Center</TableHead>
              <TableHead>Fixed Asset Account (Dr)</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Installment Month</TableHead>
              <TableHead>Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineRows.map((l) => {
              return (
                <TableRow key={l.id}>
                  <TableCell className="text-muted-foreground">{l.line_no}</TableCell>
                  <TableCell>{l.cost_center_id ? costCentersById.get(l.cost_center_id)?.name ?? "—" : "—"}</TableCell>
                  <TableCell className="font-medium">{accountsById.get(l.fixed_asset_account_id)?.account_name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(l.gross)}</TableCell>
                  <TableCell>{l.due_date ? formatDate(l.due_date) : "—"}</TableCell>
                  <TableCell>{l.installment_month ?? "—"}</TableCell>
                  <TableCell>{l.remarks ?? "—"}</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="text-right font-medium">
                Total Value
              </TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {formatMoney(voucher.total_value)} {currencyCode}
              </TableCell>
              <TableCell colSpan={3} />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="print:hidden">
        <VoucherActions
          status={status}
          voucherType="purchase_voucher"
          voucherId={voucher.id}
          journalEntryId={voucher.journal_entry_id}
          amount={voucher.total_value}
          approvalId={approval?.id ?? null}
          canSubmit={canSubmit}
          canApprove={canApprove}
          canReject={canReject}
          canPost={canPost}
          onPost={postPurchaseVoucher}
        />
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Agreements &amp; invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <AttachmentList
            bucket="agreements"
            entityType="purchase_voucher"
            entityId={voucher.id}
            items={attachmentItems}
            canEdit={canSubmit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
