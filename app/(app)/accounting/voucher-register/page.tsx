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
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { VOUCHER_TYPE_LABELS, voucherHref } from "@/lib/vouchers/meta";
import type { JournalEntryStatus, VoucherType } from "@/types/database.types";

// The status the register can be narrowed to. "pending" is what the dashboard's
// Pending approvals card links to, so that card lands on the vouchers awaiting a
// decision rather than on every voucher ever raised.
const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending", label: "Pending approval" },
  { key: "approved", label: "Approved" },
  { key: "posted", label: "Posted" },
] as const;

type RegisterRow = {
  voucher_type: string;
  voucher_id: string;
  voucher_no: string | null;
  entry_date: string;
  status: JournalEntryStatus;
  currency_id: string | null;
  amount: number;
  doc_amount: number | null;
};

export default async function VoucherRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = "" } = await searchParams;
  const active = STATUS_FILTERS.some((f) => f.key === status) ? status : "";

  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: rows }, { data: currencies }] = await Promise.all([
    (() => {
      const query = supabase
        .schema("accounting")
        .from("v_voucher_register")
        .select("*")
        .eq("company_id", companyId);
      return (active ? query.eq("status", active) : query)
        .order("entry_date", { ascending: false })
        .limit(500);
    })(),
    supabase.schema("core").from("currencies").select("id, symbol, code"),
  ]);

  const list = (rows ?? []) as unknown as RegisterRow[];
  // Each voucher is shown in the currency it was raised in, so a PKR receipt
  // never reads as if it were in the base currency.
  const symbolById = new Map(
    (currencies ?? []).map((c) => [c.id as string, (c.symbol as string) || (c.code as string)]),
  );

  const emptyDescription = active
    ? `No vouchers are ${STATUS_FILTERS.find((f) => f.key === active)!.label.toLowerCase()} right now.`
    : "Once vouchers are created across the modules, they'll all be listed here.";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Voucher Register"
        description="Every voucher across every type, most recent first."
        backHref="/accounting/vouchers"
        backLabel="Vouchers"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((filter) => {
          const isActive = filter.key === active;
          return (
            <Link
              key={filter.key || "all"}
              href={filter.key ? `/accounting/voucher-register?status=${filter.key}` : "/accounting/voucher-register"}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-ledger-dark bg-ledger/15 text-ledger-dark"
                  : "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      <div className="rounded-lg border bg-card shadow-xs">
        {list.length === 0 ? (
          <EmptyState icon={ListOrderedIcon} title="No vouchers yet" description={emptyDescription} />
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
              {list.map((row) => {
                const symbol = row.currency_id ? symbolById.get(row.currency_id) ?? "" : "";
                const amount = row.doc_amount ?? row.amount;
                return (
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
                    <TableCell className="text-right font-mono tabular-nums">
                      {symbol && <span className="mr-1 text-muted-foreground">{symbol}</span>}
                      {formatMoney(amount)}
                    </TableCell>
                    <TableCell>
                      <VoucherStatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
