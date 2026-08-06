import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AttachmentList, type AttachmentItem } from "@/components/attachments/attachment-list";
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherDeleteButton } from "@/components/vouchers/voucher-delete-button";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { deletePurchaseVoucher, postPurchaseVoucher } from "@/features/accounting/purchase-voucher/actions";
import { getSignedUrl } from "@/features/attachments/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { createClient } from "@/lib/supabase/server";
import { getVoucherApproval } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function PurchaseVoucherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

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

  const canDelete = await hasPermission("purchase_voucher", "delete");

  const { data: lines } = await supabase
    .schema("accounting")
    .from("purchase_voucher_lines")
    .select("id, line_no, asset_id, fixed_asset_account_id, gross, due_date, installment_month, remarks")
    .eq("voucher_id", id)
    .order("line_no");

  type LineRow = {
    id: string;
    line_no: number;
    asset_id: string;
    fixed_asset_account_id: string;
    gross: number;
    due_date: string | null;
    installment_month: string | null;
    remarks: string | null;
  };
  const lineRows = (lines as unknown as LineRow[]) ?? [];

  const [suppliersById, currenciesById, accountsById, assetsById] = await Promise.all([
    fetchRefs<{ id: string; name: string }>(supabase, "assets", "suppliers", "name", [voucher.supplier_id]),
    fetchRefs<{ id: string; code: string }>(supabase, "core", "currencies", "code", [voucher.currency_id]),
    fetchRefs<{ id: string; account_name: string }>(
      supabase,
      "accounting",
      "chart_of_accounts",
      "account_name",
      [voucher.vendor_account_id, ...lineRows.map((l) => l.fixed_asset_account_id)],
    ),
    fetchRefs<{ id: string; asset_code: string; asset_name: string }>(
      supabase,
      "assets",
      "assets",
      "asset_code, asset_name",
      lineRows.map((l) => l.asset_id),
    ),
  ]);

  const status =
    (voucher as unknown as { journal_entries: { status: JournalEntryStatus } | null }).journal_entries?.status ??
    "draft";
  const supplierName = suppliersById.get(voucher.supplier_id)?.name ?? "—";
  const currencyCode = currenciesById.get(voucher.currency_id)?.code ?? "";
  const vendorAccount = voucher.vendor_account_id
    ? accountsById.get(voucher.vendor_account_id)?.account_name ?? "—"
    : "—";

  const approval = await getVoucherApproval("purchase_voucher", id);

  const { data: attachments } = await supabase
    .schema("core")
    .from("attachments")
    .select("id, file_name, path, bucket")
    .eq("entity_type", "purchase_voucher")
    .eq("entity_id", id)
    .is("deleted_at", null);

  const attachmentItems: AttachmentItem[] = await Promise.all(
    (attachments ?? []).map(async (a) => ({
      id: a.id,
      fileName: a.file_name,
      url: await getSignedUrl(a.bucket, a.path),
    })),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Voucher</h1>
          <p className="font-mono text-sm text-muted-foreground">{voucher.voucher_no ?? "Draft"}</p>
        </div>
        <div className="flex items-center gap-2">
          <VoucherStatusBadge status={status} />
          {status === "draft" && canDelete && (
            <VoucherDeleteButton
              id={voucher.id}
              onDelete={deletePurchaseVoucher}
              listHref="/purchases"
              label="purchase voucher"
            />
          )}
        </div>
      </div>

      <div className="grid gap-x-8 gap-y-2 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Vendor (Cr)</p>
          <p>{vendorAccount}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Supplier</p>
          <p>{supplierName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date</p>
          <p>{voucher.purchase_date}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Currency</p>
          <p>
            {currencyCode} @ {voucher.exchange_rate.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payment terms</p>
          <p>{voucher.payment_terms ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Share %</p>
          <p>{voucher.share_percentage.toLocaleString()}</p>
        </div>
        {voucher.narration && (
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs text-muted-foreground">Narration</p>
            <p>{voucher.narration}</p>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Sno</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Fixed Asset Account (Dr)</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Installment Month</TableHead>
              <TableHead>Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineRows.map((l) => {
              const asset = assetsById.get(l.asset_id) ?? null;
              return (
                <TableRow key={l.id}>
                  <TableCell className="text-muted-foreground">{l.line_no}</TableCell>
                  <TableCell>{asset ? `${asset.asset_code} — ${asset.asset_name}` : "—"}</TableCell>
                  <TableCell>{accountsById.get(l.fixed_asset_account_id)?.account_name ?? "—"}</TableCell>
                  <TableCell className="text-right">{l.gross.toLocaleString()}</TableCell>
                  <TableCell>{l.due_date ?? "—"}</TableCell>
                  <TableCell>{l.installment_month ?? "—"}</TableCell>
                  <TableCell>{l.remarks ?? "—"}</TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={3} className="text-right font-medium">
                Total Value
              </TableCell>
              <TableCell className="text-right font-medium">
                {voucher.total_value.toLocaleString()} {currencyCode}
              </TableCell>
              <TableCell colSpan={3} />
            </TableRow>
          </TableBody>
        </Table>
      </div>

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

      <Card>
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
