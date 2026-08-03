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
import { createClient } from "@/lib/supabase/server";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function AssetSalesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: sales }, canCreate] = await Promise.all([
    supabase
      .schema("assets")
      .from("asset_sales")
      .select(
        "id, voucher_no, buyer, sale_date, sale_price, profit_loss_amount, assets:asset_id(asset_code, asset_name), journal_entries:journal_entry_id(status)",
      )
      .eq("company_id", companyId)
      .order("sale_date", { ascending: false }),
    hasPermission("asset_sales", "create"),
  ]);

  type Row = {
    id: string;
    voucher_no: string | null;
    buyer: string;
    sale_date: string;
    sale_price: number;
    profit_loss_amount: number;
    assets: { asset_code: string; asset_name: string } | null;
    journal_entries: { status: JournalEntryStatus } | null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asset Sales</h1>
          <p className="text-sm text-muted-foreground">Disposals of registered assets, with profit/loss against book value.</p>
        </div>
        {canCreate && (
          <Button asChild size="sm">
            <Link href="/sales/new">New sale</Link>
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Voucher #</TableHead>
            <TableHead>Asset</TableHead>
            <TableHead>Buyer</TableHead>
            <TableHead>Sale date</TableHead>
            <TableHead className="text-right">Sale price</TableHead>
            <TableHead className="text-right">Profit/Loss</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {((sales as unknown as Row[]) ?? []).map((sale) => (
            <TableRow key={sale.id}>
              <TableCell>
                <Link href={`/sales/${sale.id}`} className="font-medium hover:underline">
                  {sale.voucher_no ?? "Draft"}
                </Link>
              </TableCell>
              <TableCell>{sale.assets ? `${sale.assets.asset_code} — ${sale.assets.asset_name}` : "—"}</TableCell>
              <TableCell>{sale.buyer}</TableCell>
              <TableCell>{sale.sale_date}</TableCell>
              <TableCell className="text-right">{sale.sale_price.toLocaleString()}</TableCell>
              <TableCell className={`text-right ${sale.profit_loss_amount >= 0 ? "text-success" : "text-destructive"}`}>
                {sale.profit_loss_amount.toLocaleString()}
              </TableCell>
              <TableCell>
                <VoucherStatusBadge status={sale.journal_entries?.status ?? "draft"} />
              </TableCell>
            </TableRow>
          ))}
          {((sales as unknown as Row[]) ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No asset sales yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
