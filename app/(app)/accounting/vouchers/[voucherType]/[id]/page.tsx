import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherDeleteButton } from "@/components/vouchers/voucher-delete-button";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getVoucherApproval } from "@/lib/vouchers/engine";
import { isPhase5VoucherType, VOUCHER_TYPE_LABELS } from "@/lib/vouchers/meta";
import { getVoucherDetail } from "@/lib/vouchers/queries";
import { postChequeReturnVoucher } from "@/features/accounting/vouchers/cheque-return/actions";
import { postJournalVoucher } from "@/features/accounting/vouchers/journal/actions";
import { postJvMaintenanceVoucher } from "@/features/accounting/vouchers/jv-maintenance/actions";
import { postOpeningBalanceVoucher } from "@/features/accounting/vouchers/opening-balance/actions";
import { postPaymentVoucher } from "@/features/accounting/vouchers/payment/actions";
import { postPdcPaymentVoucher, setPdcPaymentStatus } from "@/features/accounting/vouchers/pdc-payment/actions";
import { postPdcReceiptVoucher, setPdcReceiptStatus } from "@/features/accounting/vouchers/pdc-receipt/actions";
import { postReceiptVoucher } from "@/features/accounting/vouchers/receipt/actions";
import { copyAccountingVoucher, deleteAccountingVoucher } from "@/features/accounting/vouchers/shared-actions";
import { PdcStatusActions } from "./pdc-status-actions";

// Voucher types whose draft can be re-opened in its form (see the /edit route).
const EDITABLE_VOUCHER_TYPES = ["receipt_voucher", "payment_voucher"] as const;

const POST_ACTIONS = {
  receipt_voucher: postReceiptVoucher,
  payment_voucher: postPaymentVoucher,
  pdc_payment_voucher: postPdcPaymentVoucher,
  pdc_receipt_voucher: postPdcReceiptVoucher,
  cheque_return_voucher: postChequeReturnVoucher,
  journal_voucher: postJournalVoucher,
  jv_maintenance_voucher: postJvMaintenanceVoucher,
  opening_balance_voucher: postOpeningBalanceVoucher,
} as const;

export default async function VoucherDetailPage({
  params,
}: {
  params: Promise<{ voucherType: string; id: string }>;
}) {
  const { voucherType, id } = await params;
  if (!isPhase5VoucherType(voucherType)) notFound();

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [detail, canSubmit, canApprove, canReject, canPost, canDelete, canCreate] = await Promise.all([
    getVoucherDetail(companyId, voucherType, id),
    hasPermission(voucherType, "edit"),
    hasPermission(voucherType, "approve"),
    hasPermission(voucherType, "reject"),
    hasPermission(voucherType, "post"),
    hasPermission(voucherType, "delete"),
    hasPermission(voucherType, "create"),
  ]);

  if (!detail) notFound();

  const approval = await getVoucherApproval(voucherType, id);
  const totalDebit = detail.lines.reduce((sum, l) => sum + l.debit, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{VOUCHER_TYPE_LABELS[voucherType]}</h1>
          <p className="font-mono text-sm text-muted-foreground">{detail.voucherNo ?? "Draft"}</p>
        </div>
        <div className="flex items-center gap-2">
          <VoucherStatusBadge status={detail.status} />
          <PrintButton />
          {detail.status === "draft" &&
            canSubmit &&
            (EDITABLE_VOUCHER_TYPES as readonly string[]).includes(voucherType) && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/accounting/vouchers/${voucherType}/${detail.id}/edit`}>
                  <PencilIcon /> Edit
                </Link>
              </Button>
            )}
          {canCreate && voucherType !== "cheque_return_voucher" && (
            <CopyVoucherButton
              id={detail.id}
              onCopy={copyAccountingVoucher.bind(null, voucherType)}
              hrefBase={`/accounting/vouchers/${voucherType}`}
              label="Voucher"
            />
          )}
          {detail.status === "draft" && canDelete && (
            <VoucherDeleteButton
              id={detail.id}
              onDelete={deleteAccountingVoucher.bind(null, voucherType)}
              listHref={`/accounting/vouchers/${voucherType}`}
              label="voucher"
            />
          )}
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">{VOUCHER_TYPE_LABELS[voucherType]}</h1>
        <p className="font-mono text-sm">{detail.voucherNo ?? "Draft"}</p>
      </div>

      <div className="grid gap-x-8 gap-y-2 rounded-md border p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Date</p>
          <p>{detail.date}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Currency</p>
          <p>{detail.currencyCode}</p>
        </div>
        {detail.fields.map((f) => (
          <div key={f.label}>
            <p className="text-xs text-muted-foreground">{f.label}</p>
            <p>{f.value}</p>
          </div>
        ))}
        {detail.narration && (
          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">Narration</p>
            <p>{detail.narration}</p>
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Cost center</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.lines.map((line, index) => (
            <TableRow key={index}>
              <TableCell className="font-mono">
                {line.accountCode} — {line.accountName}
              </TableCell>
              <TableCell>{line.costCenterName ?? "—"}</TableCell>
              <TableCell>{line.description ?? "—"}</TableCell>
              <TableCell className="text-right">{line.debit ? line.debit.toLocaleString() : ""}</TableCell>
              <TableCell className="text-right">{line.credit ? line.credit.toLocaleString() : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total</TableCell>
            <TableCell className="text-right">{totalDebit.toLocaleString()}</TableCell>
            <TableCell className="text-right">{totalDebit.toLocaleString()}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <div className="print:hidden">
        <VoucherActions
          status={detail.status}
          voucherType={voucherType}
          voucherId={detail.id}
          journalEntryId={detail.journalEntryId}
          amount={totalDebit}
          approvalId={approval?.id ?? null}
          canSubmit={canSubmit}
          canApprove={canApprove}
          canReject={canReject}
          canPost={canPost}
          onPost={POST_ACTIONS[voucherType]}
        />
      </div>

      {detail.status === "posted" && voucherType === "pdc_payment_voucher" && canSubmit && (
        <PdcStatusActions onSetStatus={(status) => setPdcPaymentStatus(detail.id, status)} />
      )}
      {detail.status === "posted" && voucherType === "pdc_receipt_voucher" && canSubmit && (
        <PdcStatusActions onSetStatus={(status) => setPdcReceiptStatus(detail.id, status)} />
      )}
    </div>
  );
}
