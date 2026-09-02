import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EscToBack } from "@/components/vouchers/esc-to-back";
import { AttachmentList, type AttachmentItem } from "@/components/attachments/attachment-list";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CopyVoucherButton } from "@/components/vouchers/copy-voucher-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { DeletePostedVoucherButton } from "@/components/vouchers/delete-posted-voucher-button";
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherDeleteButton } from "@/components/vouchers/voucher-delete-button";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { getModulePermissions, isCurrentUserAdmin } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatAccountCode, formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId, getVoucherApproval } from "@/lib/vouchers/engine";
import { isPhase5VoucherType, VOUCHER_TYPE_LABELS } from "@/lib/vouchers/meta";
import { getVoucherDetail } from "@/lib/vouchers/queries";
import { postChequeReturnVoucher } from "@/features/accounting/vouchers/cheque-return/actions";
import { postJournalVoucher } from "@/features/accounting/vouchers/journal/actions";
import { postJvMaintenanceVoucher } from "@/features/accounting/vouchers/jv-maintenance/actions";
import { postMultiCurrencyJournal } from "@/features/accounting/vouchers/multi-currency-journal/actions";
import { postOpeningBalanceVoucher } from "@/features/accounting/vouchers/opening-balance/actions";
import { postPaymentVoucher } from "@/features/accounting/vouchers/payment/actions";
import { postPdcPaymentVoucher, setPdcPaymentStatus } from "@/features/accounting/vouchers/pdc-payment/actions";
import { postPdcReceiptVoucher, setPdcReceiptStatus } from "@/features/accounting/vouchers/pdc-receipt/actions";
import { postReceiptVoucher } from "@/features/accounting/vouchers/receipt/actions";
import { copyAccountingVoucher, deleteAccountingVoucher } from "@/features/accounting/vouchers/shared-actions";
import { getSignedUrl } from "@/features/attachments/actions";
import { PdcStatusActions } from "./pdc-status-actions";

// Voucher types whose draft can be re-opened in its form (see the /edit route).
const EDITABLE_VOUCHER_TYPES = [
  "receipt_voucher",
  "payment_voucher",
  "pdc_payment_voucher",
  "pdc_receipt_voucher",
  "opening_balance_voucher",
  "journal_voucher",
  "jv_maintenance_voucher",
  "multi_currency_journal",
] as const;

const POST_ACTIONS = {
  receipt_voucher: postReceiptVoucher,
  payment_voucher: postPaymentVoucher,
  pdc_payment_voucher: postPdcPaymentVoucher,
  pdc_receipt_voucher: postPdcReceiptVoucher,
  cheque_return_voucher: postChequeReturnVoucher,
  journal_voucher: postJournalVoucher,
  jv_maintenance_voucher: postJvMaintenanceVoucher,
  opening_balance_voucher: postOpeningBalanceVoucher,
  multi_currency_journal: postMultiCurrencyJournal,
} as const;

export default async function VoucherDetailPage({
  params,
}: {
  params: Promise<{ voucherType: string; id: string }>;
}) {
  const { voucherType, id } = await params;
  if (!isPhase5VoucherType(voucherType)) notFound();

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  // Everything below is independent, so fetch it concurrently instead of in a
  // waterfall: the voucher detail, its approval row, the caller's permissions
  // (one batched lookup), and — for journal vouchers — the attachment rows.
  const [detail, approval, perms, attachments, isAdmin] = await Promise.all([
    getVoucherDetail(companyId, voucherType, id),
    getVoucherApproval(voucherType, id),
    getModulePermissions(voucherType),
    voucherType === "journal_voucher"
      ? supabase
          .schema("core")
          .from("attachments")
          .select("id, file_name, path, bucket")
          .eq("entity_type", "journal_voucher")
          .eq("entity_id", id)
          .is("deleted_at", null)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; file_name: string; path: string; bucket: string }[]),
    isCurrentUserAdmin(),
  ]);

  if (!detail) notFound();

  const canSubmit = perms.has("edit");
  // The fallback "Submit for approval" button follows the same rule as the
  // database: raising the voucher includes sending it on.
  const canSubmitForApproval = perms.has("edit") || perms.has("create");
  const canApprove = perms.has("approve");
  const canReject = perms.has("reject");
  const canPost = perms.has("post");
  const canDelete = perms.has("delete");
  const canCreate = perms.has("create");

  const totalDebit = detail.lines.reduce((sum, l) => sum + l.debit, 0);
  const hasReference = detail.lines.some((l) => l.reference);
  // A Multi-Currency Journal has a different currency per line; show each line's
  // amount in its OWN currency, and total the entry in the base currency (raw
  // amounts across currencies don't add up). Everything else is single-currency.
  const isMultiCurrency = voucherType === "multi_currency_journal";
  const baseDebitTotal = detail.lines.reduce((sum, l) => sum + (l.baseDebit ?? 0), 0);
  const baseCreditTotal = detail.lines.reduce((sum, l) => sum + (l.baseCredit ?? 0), 0);
  // Prefix line amounts with the voucher's transaction-currency symbol (e.g.
  // "Rs 200,000,000"); fall back to a bare number when none is set.
  const money = (n: number) => (detail.currencySymbol ? `${detail.currencySymbol} ${formatMoney(n)}` : formatMoney(n));
  // Per-line money for a multi-currency voucher: use the line's own currency.
  const lineMoney = (n: number, symbol: string | null | undefined) =>
    symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n);

  // Signing URLs is the one step that depends on the attachment rows; do it in
  // parallel across whatever files exist.
  const attachmentItems: AttachmentItem[] = await Promise.all(
    attachments.map(async (a) => ({
      id: a.id,
      fileName: a.file_name,
      url: await getSignedUrl(a.bucket, a.path),
    })),
  );

  return (
    <div className="space-y-6">
      <EscToBack />
      <PageHeader
        eyebrow={VOUCHER_TYPE_LABELS[voucherType]}
        title={detail.voucherNo ?? "Draft"}
        backHref={`/accounting/vouchers/${voucherType}`}
        actions={
          <>
            <VoucherStatusBadge status={detail.status} />
            <PrintButton />
            {/* Opening balances (corrections) and receipt vouchers (reversed &
                re-posted on save) stay editable even when posted; everything
                else is draft-only. */}
            {(detail.status === "draft" ||
              voucherType === "opening_balance_voucher" ||
              (voucherType === "receipt_voucher" && detail.status === "posted")) &&
              canSubmit &&
              (EDITABLE_VOUCHER_TYPES as readonly string[]).includes(voucherType) && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/accounting/vouchers/${voucherType}/${detail.id}/edit`}>
                    <PencilIcon /> Edit
                  </Link>
                </Button>
              )}
            {canCreate && voucherType !== "cheque_return_voucher" && voucherType !== "multi_currency_journal" && (
              <CopyVoucherButton
                id={detail.id}
                onCopy={copyAccountingVoucher.bind(null, voucherType)}
                hrefBase={`/accounting/vouchers/${voucherType}`}
                label="Voucher"
              />
            )}
            {/* Deletable until it is posted — draft, pending, approved, rejected
                or sent back have touched no balances. A posted voucher is in
                the ledger and only an administrator may remove it, below. */}
            {detail.status !== "posted" && canDelete && (
              <VoucherDeleteButton
                id={detail.id}
                onDelete={deleteAccountingVoucher.bind(null, voucherType)}
                listHref={`/accounting/vouchers/${voucherType}`}
                label="voucher"
              />
            )}
            {isAdmin && detail.status === "posted" && (
              <DeletePostedVoucherButton
                voucherType={voucherType}
                voucherId={detail.id}
                redirectTo={`/accounting/vouchers/${voucherType}`}
                label="voucher"
              />
            )}
          </>
        }
      />

      <div className="grid gap-x-8 gap-y-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</p>
          <p className="mt-0.5">{formatDate(detail.date)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Currency</p>
          <p className="mt-0.5">{detail.currencyCode || "—"}</p>
        </div>
        {detail.fields.map((f) => (
          <div key={f.label}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</p>
            <p className="mt-0.5">{f.value}</p>
          </div>
        ))}
        {detail.narration && (
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Narration</p>
            <p className="mt-0.5">{detail.narration}</p>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Account</TableHead>
              <TableHead>Cost center</TableHead>
              {hasReference && <TableHead>Reference</TableHead>}
              <TableHead>Description</TableHead>
              {isMultiCurrency && <TableHead>Currency</TableHead>}
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((line, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">
                  <span className="font-mono text-xs text-muted-foreground">{formatAccountCode(line.accountCode)}</span>{" "}
                  {line.accountName}
                </TableCell>
                <TableCell>{line.costCenterName ?? "—"}</TableCell>
                {hasReference && <TableCell>{line.reference ?? "—"}</TableCell>}
                <TableCell>{line.description ?? "—"}</TableCell>
                {isMultiCurrency && <TableCell className="font-mono text-xs">{line.currencyCode ?? "—"}</TableCell>}
                <TableCell className="text-right font-mono tabular-nums">
                  {line.debit ? (isMultiCurrency ? lineMoney(line.debit, line.currencySymbol) : money(line.debit)) : ""}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {line.credit ? (isMultiCurrency ? lineMoney(line.credit, line.currencySymbol) : money(line.credit)) : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {isMultiCurrency ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={hasReference ? 5 : 4}>Total (base {detail.currencyCode})</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(baseDebitTotal)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(baseCreditTotal)}</TableCell>
              </TableRow>
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={hasReference ? 4 : 3}>Total</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(totalDebit)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(totalDebit)}</TableCell>
              </TableRow>
            )}
          </TableFooter>
        </Table>
      </div>

      <div className="print:hidden">
        <VoucherActions
          status={detail.status}
          voucherType={voucherType}
          voucherId={detail.id}
          journalEntryId={detail.journalEntryId}
          amount={totalDebit}
          approvalId={approval?.id ?? null}
          canSubmit={canSubmitForApproval}
          canApprove={canApprove}
          canReject={canReject}
          canPost={canPost}
          onPost={POST_ACTIONS[voucherType]}
        />
      </div>

      {voucherType === "journal_voucher" && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
          </CardHeader>
          <CardContent>
            <AttachmentList
              bucket="attachments"
              entityType="journal_voucher"
              entityId={detail.id}
              items={attachmentItems}
              canEdit={canSubmit}
            />
          </CardContent>
        </Card>
      )}

      {detail.status === "posted" && voucherType === "pdc_payment_voucher" && canSubmit && (
        <PdcStatusActions onSetStatus={setPdcPaymentStatus.bind(null, detail.id)} />
      )}
      {detail.status === "posted" && voucherType === "pdc_receipt_voucher" && canSubmit && (
        <PdcStatusActions onSetStatus={setPdcReceiptStatus.bind(null, detail.id)} />
      )}
    </div>
  );
}
