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
import type { JournalEntryStatus } from "@/types/database.types";

export default async function UaeRentInvoicesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const { data: invoices } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .select(
      "id, voucher_no, invoice_date, amount, outstanding_balance, uae_leases:lease_id(assets:asset_id(asset_code, asset_name), tenants:tenant_id(name)), journal_entries:journal_entry_id(status)",
    )
    .eq("company_id", companyId)
    .order("invoice_date", { ascending: false });

  type Row = {
    id: string;
    voucher_no: string | null;
    invoice_date: string;
    amount: number;
    outstanding_balance: number;
    uae_leases: {
      assets: { asset_code: string; asset_name: string } | null;
      tenants: { name: string } | null;
    } | null;
    journal_entries: { status: JournalEntryStatus } | null;
  };

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
          {((invoices as unknown as Row[]) ?? []).map((inv) => (
            <TableRow key={inv.id}>
              <TableCell>
                <Link href={`/rental/uae/invoices/${inv.id}`} className="font-medium hover:underline">
                  {inv.voucher_no ?? "Draft"}
                </Link>
              </TableCell>
              <TableCell>
                {inv.uae_leases?.assets ? `${inv.uae_leases.assets.asset_code} — ${inv.uae_leases.assets.asset_name}` : "—"}
              </TableCell>
              <TableCell>{inv.uae_leases?.tenants?.name ?? "—"}</TableCell>
              <TableCell>{inv.invoice_date}</TableCell>
              <TableCell className="text-right">{inv.amount.toLocaleString()}</TableCell>
              <TableCell className="text-right">{inv.outstanding_balance.toLocaleString()}</TableCell>
              <TableCell>
                <VoucherStatusBadge status={inv.journal_entries?.status ?? "draft"} />
              </TableCell>
            </TableRow>
          ))}
          {((invoices as unknown as Row[]) ?? []).length === 0 && (
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
