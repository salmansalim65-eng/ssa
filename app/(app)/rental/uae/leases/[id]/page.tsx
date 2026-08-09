import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageNav } from "@/components/ui/page-nav";
import { GenerateInvoiceButton } from "@/components/rental/generate-invoice-button";
import { GenerateAllInvoicesButton } from "@/components/rental/generate-all-invoices-button";
import { LeaseDeleteButton } from "@/components/rental/lease-delete-button";
import { LeaseStatusMenu } from "@/components/rental/lease-status-menu";
import { Button } from "@/components/ui/button";
import { CopyVoucherButton } from "@/components/vouchers/copy-voucher-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { copyUaeLease } from "@/features/rental/uae-leases/actions";
import { PencilIcon } from "lucide-react";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

const leaseStatusVariant = { active: "success", expired: "secondary", terminated: "destructive" } as const;
const scheduleStatusVariant = {
  pending: "secondary",
  invoiced: "default",
  paid: "success",
  overdue: "destructive",
} as const;

export default async function UaeLeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: lease }, canCreate] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("*, tenants:tenant_id(name, phone, email)")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("uae_rent_invoice", "create"),
  ]);

  if (!lease) notFound();

  const [canDelete, canEdit] = await Promise.all([
    hasPermission("uae_rent_invoice", "delete"),
    hasPermission("uae_rent_invoice", "edit"),
  ]);

  const [assetsById, currenciesById] = await Promise.all([
    fetchRefs<{ id: string; asset_code: string; asset_name: string }>(
      supabase,
      "assets",
      "assets",
      "asset_code, asset_name",
      [lease.asset_id],
    ),
    fetchRefs<{ id: string; code: string }>(supabase, "core", "currencies", "code", [lease.currency_id]),
  ]);

  type Refs = {
    assets: { asset_code: string; asset_name: string } | null;
    tenants: { name: string; phone: string | null; email: string | null } | null;
    currencies: { code: string } | null;
  };
  const refs: Refs = {
    assets: assetsById.get(lease.asset_id) ?? null,
    tenants: (lease as unknown as { tenants: Refs["tenants"] }).tenants,
    currencies: currenciesById.get(lease.currency_id) ?? null,
  };
  const assetLabel = refs.assets ? `${refs.assets.asset_code} — ${refs.assets.asset_name}` : "—";

  const [{ data: schedules }, { data: invoices }] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_payment_schedules")
      .select("id, due_date, amount, status")
      .eq("lease_id", id)
      .order("due_date"),
    supabase
      .schema("rental")
      .from("uae_rent_invoices")
      .select("id, voucher_no, invoice_date, amount, outstanding_balance, journal_entry_id")
      .eq("lease_id", id)
      .order("invoice_date", { ascending: false }),
  ]);

  type InvoiceRow = {
    id: string;
    voucher_no: string | null;
    invoice_date: string;
    amount: number;
    outstanding_balance: number;
    journal_entry_id: string | null;
  };
  const invoiceRows = (invoices as unknown as InvoiceRow[]) ?? [];
  const pendingScheduleCount = (schedules ?? []).filter((s) => s.status === "pending").length;
  // journal_entries live in the `accounting` schema (cross-schema from rental).
  const invoiceStatusById = await fetchRefs<{ id: string; status: JournalEntryStatus }>(
    supabase, "accounting", "journal_entries", "status", invoiceRows.map((r) => r.journal_entry_id),
  );

  return (
    <div className="space-y-6">
      <PageNav backHref="/rental/uae/leases" />
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between print:hidden">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Lease</p>
          <h1 className="text-2xl font-semibold tracking-tight">{assetLabel}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={leaseStatusVariant[lease.status as keyof typeof leaseStatusVariant]}>{lease.status}</Badge>
          <PrintButton />
          {canEdit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/rental/uae/leases/${lease.id}/edit`}>
                <PencilIcon /> Edit
              </Link>
            </Button>
          )}
          {canCreate && (
            <CopyVoucherButton id={lease.id} onCopy={copyUaeLease} hrefBase="/rental/uae/leases" label="Lease" />
          )}
          {canCreate && <LeaseStatusMenu leaseId={lease.id} status={lease.status} />}
          {canDelete && <LeaseDeleteButton leaseId={lease.id} country="uae" />}
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">UAE Lease</h1>
        <p className="text-sm">{assetLabel}</p>
      </div>

      <div className="grid gap-x-8 gap-y-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tenant</p>
          <p className="mt-0.5">{refs.tenants?.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contact</p>
          <p className="mt-0.5">{[refs.tenants?.phone, refs.tenants?.email].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Term</p>
          <p className="mt-0.5">
            {formatDate(lease.lease_start)} – {formatDate(lease.lease_end)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rent cycle</p>
          <p className="mt-0.5 capitalize">{lease.rent_cycle}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rental amount</p>
          <p className="mt-0.5 font-mono tabular-nums">
            {formatMoney(lease.rental_amount)} {refs.currencies?.code}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Security deposit</p>
          <p className="mt-0.5 font-mono tabular-nums">
            {formatMoney(lease.security_deposit)} {refs.currencies?.code}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due date</p>
          <p className="mt-0.5">{lease.due_date ? formatDate(lease.due_date) : "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rent month</p>
          <p className="mt-0.5">{lease.rent_month ?? "—"}</p>
        </div>
        {lease.document_no && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">HH Lease voucher</p>
            <p className="mt-0.5">
              {lease.document_no}
              {lease.document_date ? ` · ${formatDate(lease.document_date)}` : ""}
            </p>
          </div>
        )}
        {lease.remarks && (
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remarks</p>
            <p className="mt-0.5">{lease.remarks}</p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Payment schedule</h2>
          {canCreate && pendingScheduleCount > 0 && (
            <GenerateAllInvoicesButton leaseId={lease.id} country="uae" pendingCount={pendingScheduleCount} />
          )}
        </div>
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(schedules ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-muted-foreground">{formatDate(s.due_date)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(s.amount)}</TableCell>
                  <TableCell>
                    <Badge variant={scheduleStatusVariant[s.status as keyof typeof scheduleStatusVariant]}>{s.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {s.status === "pending" && canCreate && <GenerateInvoiceButton scheduleId={s.id} />}
                  </TableCell>
                </TableRow>
              ))}
              {(schedules ?? []).length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No scheduled periods.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Invoices</h2>
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Voucher #</TableHead>
                <TableHead>Invoice date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoiceRows.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link
                      href={`/rental/uae/invoices/${inv.id}`}
                      className="font-mono font-medium text-primary hover:underline"
                    >
                      {inv.voucher_no ?? "Draft"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(inv.invoice_date)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(inv.amount)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(inv.outstanding_balance)}</TableCell>
                  <TableCell>
                    <VoucherStatusBadge status={invoiceStatusById.get(inv.journal_entry_id ?? "")?.status ?? "draft"} />
                  </TableCell>
                </TableRow>
              ))}
              {invoiceRows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No invoices generated yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
