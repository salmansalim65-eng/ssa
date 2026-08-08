import Link from "next/link";
import { PlusIcon, ShoppingCartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { hasPermission } from "@/lib/auth/permissions";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
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
        "id, voucher_no, purchase_date, total_value, supplier_id, journal_entries:journal_entry_id(status)",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    hasPermission("purchase_voucher", "create"),
  ]);

  type RawRow = {
    id: string;
    voucher_no: string | null;
    purchase_date: string;
    total_value: number;
    supplier_id: string | null;
    journal_entries: { status: JournalEntryStatus } | null;
  };

  const rawRows = (rows as unknown as RawRow[]) ?? [];

  const suppliersById = await fetchRefs<{ id: string; name: string }>(
    supabase,
    "assets",
    "suppliers",
    "name",
    rawRows.map((r) => r.supplier_id),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="Purchase Vouchers"
        description="Property acquisitions and their accounting entries."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/purchases/new">
                <PlusIcon /> New voucher
              </Link>
            </Button>
          )
        }
      />

      <div className="rounded-xl border bg-card shadow-sm">
        {rawRows.length === 0 ? (
          <EmptyState
            icon={ShoppingCartIcon}
            title="No purchase vouchers yet"
            description="Record a property acquisition to see it here."
            action={
              canCreate && (
                <Button asChild>
                  <Link href="/purchases/new">
                    <PlusIcon /> New voucher
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Voucher No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead className="w-36">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rawRows.map((row) => {
                const supplier = suppliersById.get(row.supplier_id ?? "") ?? null;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/purchases/${row.id}`}
                        className="font-mono font-medium text-primary hover:underline"
                      >
                        {row.voucher_no ?? "Draft"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.purchase_date)}</TableCell>
                    <TableCell>{supplier?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(row.total_value)}
                    </TableCell>
                    <TableCell>
                      <VoucherStatusBadge status={row.journal_entries?.status ?? "draft"} />
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
