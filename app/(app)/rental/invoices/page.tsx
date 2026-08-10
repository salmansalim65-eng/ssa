import { Suspense } from "react";

import Link from "next/link";
import { ReceiptIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { RentInvoiceFilters } from "@/components/rental/rent-invoice-filters";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { JournalEntryStatus } from "@/types/database.types";

// The type tabs double as quick filters. "" is the All Invoices tab.
const TABS = [
  { key: "", label: "All Invoices" },
  { key: "PK", label: "PK Invoice" },
  { key: "HH", label: "HH Invoice" },
  { key: "UAE", label: "UAE Invoice" },
] as const;

// Each invoice type routes to its own detail/print template. HH invoices are
// UAE invoices under the hood, so they reuse the UAE detail template.
const DETAIL_BASE: Record<string, string> = {
  uae: "/rental/uae/invoices",
  pk: "/rental/pk/invoices",
};

interface InvoiceRow {
  invoice_id: string;
  invoice_type: "PK" | "HH" | "UAE";
  source: "uae" | "pk";
  voucher_no: string | null;
  tenant_name: string | null;
  asset_code: string | null;
  asset_name: string | null;
  invoice_date: string;
  due_date: string;
  total_amount: number;
  currency_code: string;
  currency_symbol: string | null;
  status: JournalEntryStatus;
}

const TYPE_BADGE: Record<string, string> = {
  PK: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  HH: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  UAE: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

export default async function RentInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string; status?: string; from?: string; to?: string }>;
}) {
  const { type = "", q = "", status = "", from = "", to = "" } = await searchParams;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const { data } = await supabase
    .schema("rental")
    .from("v_rent_invoices")
    .select(
      "invoice_id, invoice_type, source, voucher_no, tenant_name, asset_code, asset_name, invoice_date, due_date, total_amount, currency_code, currency_symbol, status",
    )
    .eq("company_id", companyId)
    .order("invoice_date", { ascending: false });

  const all = (data as unknown as InvoiceRow[]) ?? [];

  // Tab counts come from the full company set (before type/search filters).
  const countByType = (t: string) => (t ? all.filter((r) => r.invoice_type === t).length : all.length);

  const query = q.toLowerCase();
  const rows = all.filter((r) => {
    if (type && r.invoice_type !== type) return false;
    if (status && r.status !== status) return false;
    if (from && r.invoice_date < from) return false;
    if (to && r.invoice_date > to) return false;
    if (query) {
      const hay = `${r.voucher_no ?? ""} ${r.tenant_name ?? ""} ${r.asset_code ?? ""} ${r.asset_name ?? ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const money = (r: InvoiceRow) =>
    r.currency_symbol ? `${r.currency_symbol} ${formatMoney(r.total_amount)}` : formatMoney(r.total_amount);

  function tabHref(key: string) {
    const params = new URLSearchParams();
    if (key) params.set("type", key);
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return qs ? `/rental/invoices?${qs}` : "/rental/invoices";
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="Lease Invoices"
        description="Every lease invoice — Pakistan, HH and UAE — in one place. Invoices are generated from their leases."
      />

      {/* Type tabs — active tab is the dark navy chrome, inactive are bordered. */}
      <div className="flex flex-wrap gap-2 print:hidden">
        {TABS.map((tab) => {
          const active = type === tab.key;
          return (
            <Link
              key={tab.key || "all"}
              href={tabHref(tab.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border-header bg-header text-header-foreground"
                  : "border-border bg-card text-foreground hover:bg-primary/[0.04]",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                  active ? "bg-white/15" : "bg-muted text-muted-foreground",
                )}
              >
                {countByType(tab.key)}
              </span>
            </Link>
          );
        })}
      </div>

      <Suspense>
        <RentInvoiceFilters defaultQuery={q} defaultStatus={status} defaultFrom={from} defaultTo={to} />
      </Suspense>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={ReceiptIcon}
            title="No invoices found"
            description="Generate invoices from a Pakistan, HH or UAE lease to see them here."
          />
        ) : (
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Invoice No</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Invoice Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.invoice_id}>
                  <TableCell>
                    <Link
                      href={`${DETAIL_BASE[r.source]}/${r.invoice_id}`}
                      className="font-mono font-medium text-primary hover:underline"
                    >
                      {r.voucher_no ?? "Draft"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TYPE_BADGE[r.invoice_type]}>
                      {r.invoice_type}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.tenant_name ?? "—"}</TableCell>
                  <TableCell>
                    {r.asset_code ? (
                      <>
                        <span className="font-mono text-xs text-muted-foreground">{r.asset_code}</span>{" "}
                        <span>{r.asset_name}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.invoice_date)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.due_date)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(r)}</TableCell>
                  <TableCell>
                    <VoucherStatusBadge status={r.status} />
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
