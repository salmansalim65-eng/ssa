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
import { formatDate, formatMoney, formatVoucherNo } from "@/lib/format";
import type { VoucherListRow } from "@/lib/vouchers/queries";
import { VoucherStatusBadge } from "./voucher-status-badge";

export function VoucherListTable({
  rows,
  voucherType,
  partyLabel = "Party",
  showAmount = true,
  baseCurrencySymbol = null,
}: {
  rows: VoucherListRow[];
  voucherType: string;
  partyLabel?: string;
  showAmount?: boolean;
  baseCurrencySymbol?: string | null;
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
        {rows.map((row) => {
          // Show the base-currency equivalent under the amount only when the
          // voucher is in a different currency (its base value rounds differently).
          const showBase =
            row.baseAmount != null && Math.round(row.baseAmount) !== Math.round(row.amount);
          return (
            <TableRow key={row.id}>
              <TableCell>
                <Link
                  href={`/accounting/vouchers/${voucherType}/${row.id}`}
                  className="font-mono font-medium text-primary hover:underline"
                >
                  {row.voucherNo ? formatVoucherNo(row.voucherNo) : "Draft"}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDate(row.date)}</TableCell>
              <TableCell className="max-w-xs truncate">{row.party || "—"}</TableCell>
              {showAmount && (
                <TableCell className="text-right font-mono tabular-nums">
                  <div>
                    {row.currencySymbol ? `${row.currencySymbol} ` : ""}
                    {formatMoney(row.amount)}
                  </div>
                  {showBase && (
                    <div className="text-xs font-normal text-muted-foreground">
                      ≈ {baseCurrencySymbol ? `${baseCurrencySymbol} ` : ""}
                      {formatMoney(row.baseAmount as number)}
                    </div>
                  )}
                </TableCell>
              )}
              <TableCell>
                <VoucherStatusBadge status={row.status} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
