import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

export default async function AssetValuationReportPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const { data: rows } = await supabase
    .schema("assets")
    .from("v_asset_valuation")
    .select("*")
    .eq("company_id", companyId)
    .order("asset_code");

  const totalPurchase = (rows ?? []).reduce((sum, r) => sum + (r.purchase_value ?? 0), 0);
  const totalCurrent = (rows ?? []).reduce((sum, r) => sum + (r.current_value ?? 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Asset Valuation Report</h1>
        <p className="text-sm text-muted-foreground">
          Purchase value vs. current value (latest recorded valuation) per
          asset. Reporting only — no accounting impact.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
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
              <TableCell className="font-mono">{row.asset_code}</TableCell>
              <TableCell>{row.asset_name}</TableCell>
              <TableCell>
                {row.city ? `${row.city}, ` : ""}
                {row.country}
              </TableCell>
              <TableCell className="text-right">{(row.purchase_value ?? 0).toLocaleString()}</TableCell>
              <TableCell className="text-right">{(row.current_value ?? 0).toLocaleString()}</TableCell>
              <TableCell
                className={`text-right ${(row.variance ?? 0) < 0 ? "text-destructive" : (row.variance ?? 0) > 0 ? "text-success" : ""}`}
              >
                {(row.variance ?? 0).toLocaleString()}
              </TableCell>
              <TableCell>{row.latest_valuation_date ?? "—"}</TableCell>
              <TableCell>{row.latest_valuer ?? "—"}</TableCell>
            </TableRow>
          ))}
          {(rows ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                No assets registered yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {(rows ?? []).length > 0 && (
          <tfoot>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">{totalPurchase.toLocaleString()}</TableCell>
              <TableCell className="text-right font-medium">{totalCurrent.toLocaleString()}</TableCell>
              <TableCell className="text-right font-medium">{(totalCurrent - totalPurchase).toLocaleString()}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
