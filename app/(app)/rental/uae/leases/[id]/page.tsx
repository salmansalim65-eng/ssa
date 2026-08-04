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
import { GenerateInvoiceButton } from "@/components/rental/generate-invoice-button";
import { LeaseStatusMenu } from "@/components/rental/lease-status-menu";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
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

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

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
  // journal_entries live in the `accounting` schema (cross-schema from rental).
  const invoiceStatusById = await fetchRefs<{ id: string; status: JournalEntryStatus }>(
    supabase, "accounting", "journal_entries", "status", invoiceRows.map((r) => r.journal_entry_id),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">UAE Lease</h1>
          <p className="text-sm text-muted-foreground">
            {refs.assets ? `${refs.assets.asset_code} — ${refs.assets.asset_name}` : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={leaseStatusVariant[lease.status as keyof typeof leaseStatusVariant]}>{lease.status}</Badge>
          {canCreate && <LeaseStatusMenu leaseId={lease.id} status={lease.status} />}
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
          <p className="text-xs text-muted-foreground">Rent cycle</p>
          <p className="capitalize">{lease.rent_cycle}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Rental amount</p>
          <p>
            {lease.rental_amount.toLocaleString()} {refs.currencies?.code}
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
                  {s.status === "pending" && canCreate && <GenerateInvoiceButton scheduleId={s.id} />}
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
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoiceRows.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  <Link href={`/rental/uae/invoices/${inv.id}`} className="font-medium hover:underline">
                    {inv.voucher_no ?? "Draft"}
                  </Link>
                </TableCell>
                <TableCell>{inv.invoice_date}</TableCell>
                <TableCell className="text-right">{inv.amount.toLocaleString()}</TableCell>
                <TableCell className="text-right">{inv.outstanding_balance.toLocaleString()}</TableCell>
                <TableCell>
                  <VoucherStatusBadge status={invoiceStatusById.get(inv.journal_entry_id ?? "")?.status ?? "draft"} />
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
