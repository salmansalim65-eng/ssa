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
import { fetchRefs } from "@/lib/supabase/hydrate";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function UaeRentInvoicesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">UAE Rent Invoices</h1>
        <p className="text-sm text-muted-foreground">Invoices generated from UAE lease payment schedules.</p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
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
                  <Link href={`/rental/uae/invoices/${inv.id}`} className="font-medium hover:underline">
                    {inv.voucher_no ?? "Draft"}
                  </Link>
                </TableCell>
                <TableCell>{asset ? `${asset.asset_code} — ${asset.asset_name}` : "—"}</TableCell>
                <TableCell>{inv.uae_leases?.tenants?.name ?? "—"}</TableCell>
                <TableCell>{inv.invoice_date}</TableCell>
                <TableCell className="text-right">{inv.amount.toLocaleString()}</TableCell>
                <TableCell className="text-right">{inv.outstanding_balance.toLocaleString()}</TableCell>
                <TableCell>
                  <VoucherStatusBadge status={status} />
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No invoices yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
