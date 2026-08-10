import Link from "next/link";
import { FileTextIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import type { VoucherListRow } from "@/lib/vouchers/queries";
import { VoucherStatusBadge } from "./voucher-status-badge";

export function VoucherListTable({
  rows,
  voucherType,
  partyLabel = "Party",
  showAmount = true,
}: {
  rows: VoucherListRow[];
  voucherType: string;
  partyLabel?: string;
  showAmount?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title="No vouchers yet"
        description="Vouchers you create will appear here, newest first."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Voucher No.</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>{partyLabel}</TableHead>
          {showAmount && <TableHead className="text-right">Amount</TableHead>}
          <TableHead className="w-36">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link
                href={`/accounting/vouchers/${voucherType}/${row.id}`}
                className="font-mono font-medium text-primary hover:underline"
              >
                {row.voucherNo ?? "Draft"}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(row.date)}</TableCell>
            <TableCell className="max-w-xs truncate">{row.party || "—"}</TableCell>
            {showAmount && (
              <TableCell className="text-right font-mono tabular-nums">
                {row.currencySymbol ? `${row.currencySymbol} ` : ""}
                {formatMoney(row.amount)}
              </TableCell>
            )}
            <TableCell>
              <VoucherStatusBadge status={row.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
