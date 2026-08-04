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
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { postPurchaseVoucher } from "@/features/accounting/purchase-voucher/actions";
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
      .select(
        "*, journal_entries:journal_entry_id(status)",
      )
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("purchase_voucher", "edit"),
    hasPermission("purchase_voucher", "approve"),
    hasPermission("purchase_voucher", "reject"),
    hasPermission("purchase_voucher", "post"),
  ]);

  if (!voucher) notFound();

  const [assetsById, suppliersById, currenciesById] = await Promise.all([
    fetchRefs<{ id: string; asset_code: string; asset_name: string }>(
      supabase,
      "assets",
      "assets",
      "asset_code, asset_name",
      [voucher.asset_id],
    ),
    fetchRefs<{ id: string; name: string }>(supabase, "assets", "suppliers", "name", [
      voucher.supplier_id,
    ]),
    fetchRefs<{ id: string; code: string }>(supabase, "core", "currencies", "code", [
      voucher.currency_id,
    ]),
  ]);

  const refs = {
    assets: assetsById.get(voucher.asset_id) ?? null,
    suppliers: suppliersById.get(voucher.supplier_id) ?? null,
    currencies: currenciesById.get(voucher.currency_id) ?? null,
    journal_entries: (voucher as unknown as {
      journal_entries: { status: JournalEntryStatus } | null;
    }).journal_entries,
  };

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
        <VoucherStatusBadge status={refs.journal_entries?.status ?? "draft"} />
      </div>

      <div className="grid gap-x-8 gap-y-2 rounded-md border p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Asset</p>
          <p>{refs.assets ? `${refs.assets.asset_code} — ${refs.assets.asset_name}` : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Supplier</p>
          <p>{refs.suppliers?.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Purchase date</p>
          <p>{voucher.purchase_date}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Currency</p>
          <p>{refs.currencies?.code ?? "—"}</p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Purchase price</TableCell>
            <TableCell className="text-right">{voucher.purchase_price.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Taxes</TableCell>
            <TableCell className="text-right">{voucher.taxes.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Registration charges</TableCell>
            <TableCell className="text-right">{voucher.registration_charges.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Additional expenses</TableCell>
            <TableCell className="text-right">{voucher.additional_expenses.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Total</TableCell>
            <TableCell className="text-right font-medium">{voucher.total_amount.toLocaleString()}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <VoucherActions
        status={refs.journal_entries?.status ?? "draft"}
        voucherType="purchase_voucher"
        voucherId={voucher.id}
        journalEntryId={voucher.journal_entry_id}
        amount={voucher.total_amount}
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
