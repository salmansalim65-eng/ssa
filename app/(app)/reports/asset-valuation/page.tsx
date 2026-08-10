import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";

export default async function AssetValuationReportPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const { data: rows } = await supabase
    .schema("assets")
    .from("v_asset_valuation")
    .select("*")
    .eq("company_id", companyId)
    .order("asset_code");

  const totalPurchase = (rows ?? []).reduce((sum, r) => sum + (r.purchase_value ?? 0), 0);
  const totalCurrent = (rows ?? []).reduce((sum, r) => sum + (r.current_value ?? 0), 0);

  const csvRows = (rows ?? []).map((r) => [
    r.asset_code,
    r.asset_name,
    [r.city, r.country].filter(Boolean).join(", "),
    r.purchase_value ?? 0,
    r.current_value ?? 0,
    r.variance ?? 0,
    r.latest_valuation_date ? formatDate(r.latest_valuation_date) : "",
    r.latest_valuer ?? "",
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Asset Valuation Report"
        description="Purchase value vs. current value (latest recorded valuation) per asset. Reporting only — no accounting impact."
        className="print:hidden"
        actions={
          <>
            {(rows ?? []).length > 0 && (
              <CsvExportButton
                filename="asset-valuation.csv"
                headers={[
                  "Code",
                  "Name",
                  "Location",
                  "Purchase Value",
                  "Current Value",
                  "Variance",
                  "Latest Valuation",
                  "Valuer",
                ]}
                rows={csvRows}
              />
            )}
            <PrintButton />
          </>
        }
      />

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Purchase value</TableHead>
              <TableHead className="text-right">Current value</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead>Latest valuation</TableHead>
              <TableHead>Valuer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((row) => (
              <TableRow key={row.asset_id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{row.asset_code}</TableCell>
                <TableCell className="font-medium">{row.asset_name}</TableCell>
                <TableCell>
                  {row.city ? `${row.city}, ` : ""}
                  {row.country}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.purchase_value ?? 0)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.current_value ?? 0)}</TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${(row.variance ?? 0) < 0 ? "text-destructive" : (row.variance ?? 0) > 0 ? "text-success" : ""}`}
                >
                  {formatMoney(row.variance ?? 0)}
                </TableCell>
                <TableCell>{row.latest_valuation_date ? formatDate(row.latest_valuation_date) : "—"}</TableCell>
                <TableCell>{row.latest_valuer ?? "—"}</TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No assets registered yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {(rows ?? []).length > 0 && (
            <tfoot className="border-t bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{formatMoney(totalPurchase)}</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{formatMoney(totalCurrent)}</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{formatMoney(totalCurrent - totalPurchase)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
