import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2Icon, ClockIcon, FileTextIcon, PencilLineIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryCard } from "@/components/ui/summary-card";
import { VoucherListTable } from "@/components/vouchers/voucher-list-table";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { getVoucherListRows } from "@/lib/vouchers/queries";
import { isPhase5VoucherType, VOUCHER_TYPE_LABELS } from "@/lib/vouchers/meta";

const NO_AMOUNT_TYPES = new Set(["journal_voucher", "jv_maintenance_voucher"]);
const PARTY_LABELS: Record<string, string> = {
  receipt_voucher: "Received from",
  payment_voucher: "Paid to",
  pdc_payment_voucher: "Payee",
  pdc_receipt_voucher: "Payer",
  cheque_return_voucher: "Return reason",
  journal_voucher: "Narration",
  jv_maintenance_voucher: "Adjustment reason",
  opening_balance_voucher: "Account",
};

export default async function VoucherListPage({
  params,
}: {
  params: Promise<{ voucherType: string }>;
}) {
  const { voucherType } = await params;
  if (!isPhase5VoucherType(voucherType)) notFound();

  const companyId = await getCurrentCompanyId();

  const [rows, canCreate] = await Promise.all([
    getVoucherListRows(companyId, voucherType),
    hasPermission(voucherType, "create"),
  ]);

  const label = VOUCHER_TYPE_LABELS[voucherType];
  const drafts = rows.filter((r) => r.status === "draft").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const posted = rows.filter((r) => r.status === "posted").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Vouchers"
        title={label}
        description={`Create, review, approve and post ${label.toLowerCase()}.`}
        actions={
          canCreate && (
            <Button asChild>
              <Link href={`/accounting/vouchers/${voucherType}/new`}>
                <PlusIcon /> New voucher
              </Link>
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total" value={rows.length} icon={FileTextIcon} accent="primary" />
        <SummaryCard label="Draft" value={drafts} icon={PencilLineIcon} accent="neutral" />
        <SummaryCard label="Pending approval" value={pending} icon={ClockIcon} accent="warning" />
        <SummaryCard label="Posted" value={posted} icon={CheckCircle2Icon} accent="success" />
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <VoucherListTable
          rows={rows}
          voucherType={voucherType}
          partyLabel={PARTY_LABELS[voucherType]}
          showAmount={!NO_AMOUNT_TYPES.has(voucherType)}
        />
      </div>
    </div>
  );
}
