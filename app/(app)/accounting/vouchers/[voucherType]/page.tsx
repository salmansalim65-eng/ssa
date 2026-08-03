import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { VoucherListTable } from "@/components/vouchers/voucher-list-table";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [rows, canCreate] = await Promise.all([
    getVoucherListRows(companyId, voucherType),
    hasPermission(voucherType, "create"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{VOUCHER_TYPE_LABELS[voucherType]}</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} voucher{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        {canCreate && (
          <Button asChild size="sm">
            <Link href={`/accounting/vouchers/${voucherType}/new`}>New</Link>
          </Button>
        )}
      </div>

      <VoucherListTable
        rows={rows}
        voucherType={voucherType}
        partyLabel={PARTY_LABELS[voucherType]}
        showAmount={!NO_AMOUNT_TYPES.has(voucherType)}
      />
    </div>
  );
}
