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
import { GeneratePkInvoiceDialog } from "@/components/rental/generate-pk-invoice-dialog";
import { PkLeaseStatusMenu } from "@/components/rental/pk-lease-status-menu";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { JournalEntryStatus } from "@/types/database.types";

const leaseStatusVariant = { active: "success", expired: "secondary", terminated: "destructive" } as const;
const scheduleStatusVariant = {
  pending: "secondary",
  invoiced: "default",
  paid: "success",
  overdue: "destructive",
} as const;

export default async function PkLeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: lease }, canCreate] = await Promise.all([
    supabase
      .schema("rental")
      .from("pk_leases")
      .select(
        "*, assets:asset_id(asset_code, asset_name), tenants:tenant_id(name, phone, email), currencies:currency_id(code)",
      )
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("pk_rent_invoice", "create"),
  ]);

  if (!lease) notFound();

  type Refs = {
    assets: { asset_code: string; asset_name: string } | null;
    tenants: { name: string; phone: string | null; email: string | null } | null;
    currencies: { code: string } | null;
  };
  const refs = lease as unknown as Refs;

  const [{ data: schedules }, { data: invoices }] = await Promise.all([
    supabase
      .schema("rental")
      .from("pk_payment_schedules")
      .select("id, due_date, amount, status")
      .eq("lease_id", id)
      .order("due_date"),
    supabase
      .schema("rental")
      .from("pk_rent_invoices")
      .select(
        "id, voucher_no, invoice_date, total_amount, outstanding_amount, advance_adjusted, journal_entries:journal_entry_id(status)",
      )
      .eq("lease_id", id)
      .order("invoice_date", { ascending: false }),
  ]);

  type InvoiceRow = {
    id: string;
    voucher_no: string | null;
    invoice_date: string;
    total_amount: number;
    outstanding_amount: number;
    advance_adjusted: number;
    journal_entries: { status: JournalEntryStatus } | null;
  };

  const invoiceRows = (invoices as unknown as InvoiceRow[]) ?? [];
  const advanceAlreadyAdjusted = invoiceRows.reduce((sum, inv) => sum + inv.advance_adjusted, 0);
  const remainingAdvance = Math.max(lease.advance_rent - advanceAlreadyAdjusted, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pakistan Lease</h1>
          <p className="text-sm text-muted-foreground">
            {refs.assets ? `${refs.assets.asset_code} — ${refs.assets.asset_name}` : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={leaseStatusVariant[lease.status as keyof typeof leaseStatusVariant]}>{lease.status}</Badge>
          {canCreate && <PkLeaseStatusMenu leaseId={lease.id} status={lease.status} />}
        </div>
      </div>

      <div className="grid gap-x-8 gap-y-2 rounded-md border p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Tenant</p>
          <p>{refs.tenants?.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Contact</p>
          <p>{[refs.tenants?.phone, refs.tenants?.email].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Term</p>
          <p>
            {lease.lease_start} – {lease.lease_end}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Monthly rent</p>
          <p>
            {lease.monthly_rent.toLocaleString()} {refs.currencies?.code}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Advance rent (remaining)</p>
          <p>
            {remainingAdvance.toLocaleString()} / {lease.advance_rent.toLocaleString()} {refs.currencies?.code}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Security deposit</p>
          <p>
            {lease.security_deposit.toLocaleString()} {refs.currencies?.code}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Payment schedule</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(schedules ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.due_date}</TableCell>
                <TableCell className="text-right">{s.amount.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={scheduleStatusVariant[s.status as keyof typeof scheduleStatusVariant]}>{s.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {s.status === "pending" && canCreate && (
                    <GeneratePkInvoiceDialog scheduleId={s.id} rentAmount={s.amount} remainingAdvance={remainingAdvance} />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(schedules ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No scheduled periods.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Invoices</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Voucher #</TableHead>
              <TableHead>Invoice date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoiceRows.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  <Link href={`/rental/pk/invoices/${inv.id}`} className="font-medium hover:underline">
                    {inv.voucher_no ?? "Draft"}
                  </Link>
                </TableCell>
                <TableCell>{inv.invoice_date}</TableCell>
                <TableCell className="text-right">{inv.total_amount.toLocaleString()}</TableCell>
                <TableCell className="text-right">{inv.outstanding_amount.toLocaleString()}</TableCell>
                <TableCell>
                  <VoucherStatusBadge status={inv.journal_entries?.status ?? "draft"} />
                </TableCell>
              </TableRow>
            ))}
            {invoiceRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No invoices generated yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
