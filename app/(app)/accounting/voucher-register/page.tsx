import Link from "next/link";

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
import { VOUCHER_TYPE_LABELS, voucherHref } from "@/lib/vouchers/meta";
import type { VoucherType } from "@/types/database.types";

export default async function VoucherRegisterPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const { data: rows } = await supabase
    .schema("accounting")
    .from("v_voucher_register")
    .select("*")
    .eq("company_id", companyId)
    .order("entry_date", { ascending: false })
    .limit(500);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Voucher Register</h1>
        <p className="text-sm text-muted-foreground">
          Every voucher across every type, most recent first.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Voucher no</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((row) => (
            <TableRow key={`${row.voucher_type}-${row.voucher_id}`}>
              <TableCell>
                <Link
                  href={voucherHref(row.voucher_type as VoucherType, row.voucher_id)}
                  className="font-mono font-medium hover:underline"
                >
                  {row.voucher_no ?? "Draft"}
                </Link>
              </TableCell>
              <TableCell>{VOUCHER_TYPE_LABELS[row.voucher_type as VoucherType]}</TableCell>
              <TableCell>{row.entry_date}</TableCell>
              <TableCell>{row.amount.toLocaleString()}</TableCell>
              <TableCell>
                <VoucherStatusBadge status={row.status} />
              </TableCell>
            </TableRow>
          ))}
          {(rows ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No vouchers posted yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
