import Link from "next/link";
import { ReceiptIcon } from "lucide-react";

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
import { fetchRefs } from "@/lib/supabase/hydrate";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function UaeRentInvoicesPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  // `uae_leases:lease_id` and its nested `tenants:tenant_id` are same-schema
  // (rental) embeds and work; the asset (assets schema) and journal entry
  // (accounting schema) are cross-schema, so they are pulled in separately.
  const { data: invoices } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .select(
      "id, voucher_no, invoice_date, amount, outstanding_balance, journal_entry_id, uae_leases:lease_id(asset_id, tenants:tenant_id(name))",
    )
    .eq("company_id", companyId)
    .order("invoice_date", { ascending: false });

  type RawRow = {
    id: string;
    voucher_no: string | null;
    invoice_date: string;
    amount: number;
    outstanding_balance: number;
    journal_entry_id: string | null;
    uae_leases: {
      asset_id: string | null;
      tenants: { name: string } | null;
    } | null;
  };

  const rows = (invoices as unknown as RawRow[]) ?? [];
  const [assetsById, journalEntriesById] = await Promise.all([
    fetchRefs<{ id: string; asset_code: string; asset_name: string }>(
      supabase,
      "assets",
      "assets",
      "asset_code, asset_name",
      rows.map((r) => r.uae_leases?.asset_id),
    ),
    fetchRefs<{ id: string; status: JournalEntryStatus }>(
      supabase,
      "accounting",
      "journal_entries",
      "status",
      rows.map((r) => r.journal_entry_id),
    ),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="UAE Rent Invoices"
        description="Invoices generated from UAE lease payment schedules."
      />

      <div className="rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={ReceiptIcon}
            title="No invoices yet"
            description="Generate an invoice from a UAE lease payment schedule to see it here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Voucher #</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Invoice date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((inv) => {
                const asset = inv.uae_leases?.asset_id ? assetsById.get(inv.uae_leases.asset_id) ?? null : null;
                const status = journalEntriesById.get(inv.journal_entry_id ?? "")?.status ?? "draft";
                return (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link
                        href={`/rental/uae/invoices/${inv.id}`}
                        className="font-mono font-medium text-primary hover:underline"
                      >
                        {inv.voucher_no ?? "Draft"}
                      </Link>
                    </TableCell>
                    <TableCell>{asset ? `${asset.asset_code} — ${asset.asset_name}` : "—"}</TableCell>
                    <TableCell>{inv.uae_leases?.tenants?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(inv.invoice_date)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(inv.amount)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(inv.outstanding_balance)}</TableCell>
                    <TableCell>
                      <VoucherStatusBadge status={status} />
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
