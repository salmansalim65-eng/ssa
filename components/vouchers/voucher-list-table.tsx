import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Voucher no</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>{partyLabel}</TableHead>
          {showAmount && <TableHead>Amount</TableHead>}
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link
                href={`/accounting/vouchers/${voucherType}/${row.id}`}
                className="font-mono font-medium hover:underline"
              >
                {row.voucherNo ?? "Draft"}
              </Link>
            </TableCell>
            <TableCell>{row.date}</TableCell>
            <TableCell className="max-w-xs truncate">{row.party}</TableCell>
            {showAmount && <TableCell>{row.amount.toLocaleString()}</TableCell>}
            <TableCell>
              <VoucherStatusBadge status={row.status} />
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={showAmount ? 5 : 4} className="text-center text-muted-foreground">
              No vouchers yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
