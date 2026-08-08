import Link from "next/link";
import { BadgeDollarSignIcon, PlusIcon } from "lucide-react";

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
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function AssetSalesPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: sales }, canCreate] = await Promise.all([
    supabase
      .schema("assets")
      .from("asset_sales")
      .select("id, voucher_no, sale_date, total_value, customer_account_id, journal_entry_id")
      .eq("company_id", companyId)
      .order("sale_date", { ascending: false }),
    hasPermission("asset_sales", "create"),
  ]);

  type SaleRow = {
    id: string;
    voucher_no: string | null;
    sale_date: string;
    total_value: number;
    customer_account_id: string | null;
    journal_entry_id: string | null;
  };

  const saleRows = (sales as unknown as SaleRow[]) ?? [];

  const [journalEntriesById, accountsById] = await Promise.all([
    fetchRefs<{ id: string; status: JournalEntryStatus }>(
      supabase,
      "accounting",
      "journal_entries",
      "status",
      saleRows.map((r) => r.journal_entry_id),
    ),
    fetchRefs<{ id: string; account_name: string }>(
      supabase,
      "accounting",
      "chart_of_accounts",
      "account_name",
      saleRows.map((r) => r.customer_account_id),
    ),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="Sale Asset Vouchers"
        description="Property disposals and their accounting entries."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/sales/new">
                <PlusIcon /> New voucher
              </Link>
            </Button>
          )
        }
      />

      <div className="rounded-lg border bg-card shadow-xs">
        {saleRows.length === 0 ? (
          <EmptyState
            icon={BadgeDollarSignIcon}
            title="No sale asset vouchers yet"
            description="Record a property disposal to see it here."
            action={
              canCreate && (
                <Button asChild>
                  <Link href="/sales/new">
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
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead className="w-36">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {saleRows.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>
                    <Link
                      href={`/sales/${sale.id}`}
                      className="font-mono font-medium text-primary hover:underline"
                    >
                      {sale.voucher_no ?? "Draft"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(sale.sale_date)}</TableCell>
                  <TableCell>{accountsById.get(sale.customer_account_id ?? "")?.account_name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(sale.total_value)}
                  </TableCell>
                  <TableCell>
                    <VoucherStatusBadge
                      status={journalEntriesById.get(sale.journal_entry_id ?? "")?.status ?? "draft"}
                    />
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
