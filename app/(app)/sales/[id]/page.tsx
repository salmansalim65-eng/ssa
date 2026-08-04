import { notFound } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { postAssetSale } from "@/features/assets/sale/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { getVoucherApproval } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function AssetSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: sale }, canSubmit, canApprove, canReject, canPost] = await Promise.all([
    supabase
      .schema("assets")
      .from("asset_sales")
      .select("*, assets:asset_id(asset_code, asset_name)")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("asset_sales", "edit"),
    hasPermission("asset_sales", "approve"),
    hasPermission("asset_sales", "reject"),
    hasPermission("asset_sales", "post"),
  ]);

  if (!sale) notFound();

  type Refs = {
    assets: { asset_code: string; asset_name: string } | null;
    currencies: { code: string } | null;
    journal_entries: { status: JournalEntryStatus } | null;
  };
  const saleAssets = (sale as unknown as {
    assets: { asset_code: string; asset_name: string } | null;
  }).assets;

  const [currenciesById, journalEntriesById] = await Promise.all([
    fetchRefs<{ id: string; code: string }>(
      supabase,
      "core",
      "currencies",
      "code",
      [sale.currency_id],
    ),
    fetchRefs<{ id: string; status: JournalEntryStatus }>(
      supabase,
      "accounting",
      "journal_entries",
      "status",
      [sale.journal_entry_id],
    ),
  ]);

  const refs: Refs = {
    assets: saleAssets,
    currencies: currenciesById.get(sale.currency_id) ?? null,
    journal_entries: journalEntriesById.get(sale.journal_entry_id) ?? null,
  };

  const approval = await getVoucherApproval("asset_sales", id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asset Sale</h1>
          <p className="font-mono text-sm text-muted-foreground">{sale.voucher_no ?? "Draft"}</p>
        </div>
        <VoucherStatusBadge status={refs.journal_entries?.status ?? "draft"} />
      </div>

      <div className="grid gap-x-8 gap-y-2 rounded-md border p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Asset</p>
          <p>{refs.assets ? `${refs.assets.asset_code} — ${refs.assets.asset_name}` : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Buyer</p>
          <p>{sale.buyer}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sale date</p>
          <p>{sale.sale_date}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Currency</p>
          <p>{refs.currencies?.code ?? "—"}</p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Sale price</TableCell>
            <TableCell className="text-right">{sale.sale_price.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Book value at sale</TableCell>
            <TableCell className="text-right">{sale.book_value_at_sale.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Profit / (Loss)</TableCell>
            <TableCell
              className={`text-right font-medium ${sale.profit_loss_amount >= 0 ? "text-success" : "text-destructive"}`}
            >
              {sale.profit_loss_amount.toLocaleString()}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Original purchase value</TableCell>
            <TableCell className="text-right">{sale.purchase_value_at_sale.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Capital gain / (loss)</TableCell>
            <TableCell
              className={`text-right font-medium ${sale.capital_gain_amount >= 0 ? "text-success" : "text-destructive"}`}
            >
              {sale.capital_gain_amount.toLocaleString()}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <VoucherActions
        status={refs.journal_entries?.status ?? "draft"}
        voucherType="asset_sales"
        voucherId={sale.id}
        journalEntryId={sale.journal_entry_id}
        amount={sale.sale_price}
        approvalId={approval?.id ?? null}
        canSubmit={canSubmit}
        canApprove={canApprove}
        canReject={canReject}
        canPost={canPost}
        onPost={postAssetSale}
      />
    </div>
  );
}
