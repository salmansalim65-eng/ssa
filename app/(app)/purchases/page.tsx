import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { hasPermission } from "@/lib/auth/permissions";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { createClient } from "@/lib/supabase/server";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function PurchasesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: rows }, canCreate] = await Promise.all([
    supabase
      .schema("accounting")
      .from("purchase_vouchers")
      .select(
        "id, voucher_no, purchase_date, total_amount, asset_id, supplier_id, journal_entries:journal_entry_id(status)",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    hasPermission("purchase_voucher", "create"),
  ]);

  type RawRow = {
    id: string;
    voucher_no: string | null;
    purchase_date: string;
    total_amount: number;
    asset_id: string | null;
    supplier_id: string | null;
    journal_entries: { status: JournalEntryStatus } | null;
  };

  const rawRows = (rows as unknown as RawRow[]) ?? [];

  const [assetsById, suppliersById] = await Promise.all([
    fetchRefs<{ id: string; asset_code: string; asset_name: string }>(
      supabase,
      "assets",
      "assets",
      "asset_code, asset_name",
      rawRows.map((r) => r.asset_id),
    ),
    fetchRefs<{ id: string; name: string }>(
      supabase,
      "assets",
      "suppliers",
      "name",
      rawRows.map((r) => r.supplier_id),
    ),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Vouchers</h1>
          <p className="text-sm text-muted-foreground">Property acquisitions and their accounting entries.</p>
        </div>
        {canCreate && (
          <Button asChild size="sm">
            <Link href="/purchases/new">New</Link>
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Voucher no</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Asset</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rawRows.map((row) => {
            const asset = assetsById.get(row.asset_id ?? "") ?? null;
            const supplier = suppliersById.get(row.supplier_id ?? "") ?? null;
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/purchases/${row.id}`} className="font-mono font-medium hover:underline">
                    {row.voucher_no ?? "Draft"}
                  </Link>
                </TableCell>
                <TableCell>{row.purchase_date}</TableCell>
                <TableCell>
                  {asset ? `${asset.asset_code} — ${asset.asset_name}` : "—"}
                </TableCell>
                <TableCell>{supplier?.name ?? "—"}</TableCell>
                <TableCell>{row.total_amount.toLocaleString()}</TableCell>
                <TableCell>
                  <VoucherStatusBadge status={row.journal_entries?.status ?? "draft"} />
                </TableCell>
              </TableRow>
            );
          })}
          {rawRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No purchase vouchers yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
