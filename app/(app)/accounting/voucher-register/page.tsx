import Link from "next/link";
import { ListOrderedIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { VOUCHER_TYPE_LABELS, voucherHref } from "@/lib/vouchers/meta";
import type { VoucherType } from "@/types/database.types";

export default async function VoucherRegisterPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const { data: rows } = await supabase
    .schema("accounting")
    .from("v_voucher_register")
    .select("*")
    .eq("company_id", companyId)
    .order("entry_date", { ascending: false })
    .limit(500);

  const list = rows ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Voucher Register"
        description="Every voucher across every type, most recent first."
      />

      <div className="rounded-xl border bg-card shadow-sm">
        {list.length === 0 ? (
          <EmptyState
            icon={ListOrderedIcon}
            title="No vouchers yet"
            description="Once vouchers are created across the modules, they'll all be listed here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Voucher No.</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-36">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((row) => (
                <TableRow key={`${row.voucher_type}-${row.voucher_id}`}>
                  <TableCell>
                    <Link
                      href={voucherHref(row.voucher_type as VoucherType, row.voucher_id)}
                      className="font-mono font-medium text-primary hover:underline"
                    >
                      {row.voucher_no ?? "Draft"}
                    </Link>
                  </TableCell>
                  <TableCell>{VOUCHER_TYPE_LABELS[row.voucher_type as VoucherType]}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.entry_date)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.amount)}</TableCell>
                  <TableCell>
                    <VoucherStatusBadge status={row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
