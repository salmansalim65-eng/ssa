import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { createClient } from "@/lib/supabase/server";

const statusVariant = { active: "success", inactive: "secondary", sold: "outline" } as const;

export default async function AssetRegisterPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const { data: rows } = await supabase
    .schema("reporting")
    .from("v_asset_register")
    .select("*")
    .eq("company_id", companyId)
    .order("asset_code");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asset Register</h1>
          <p className="text-sm text-muted-foreground">Every registered asset, its purchase cost, and current status.</p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="asset-register.csv"
            headers={[
              "Code",
              "Name",
              "Type",
              "Country",
              "City",
              "Owner",
              "Purchase Date",
              "Purchase Value",
              "Current Value",
              "Status",
            ]}
            rows={(rows ?? []).map((r) => [
              r.asset_code,
              r.asset_name,
              r.property_type,
              r.country,
              r.city ?? "",
              r.owner ?? "",
              r.purchase_date ?? "",
              r.purchase_value ?? 0,
              r.current_value ?? 0,
              r.status,
            ])}
          />
          <PrintButton />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Purchase value</TableHead>
            <TableHead className="text-right">Current value</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((r) => (
            <TableRow key={r.asset_id}>
              <TableCell className="font-mono">{r.asset_code}</TableCell>
              <TableCell>{r.asset_name}</TableCell>
              <TableCell>{r.property_type}</TableCell>
              <TableCell>
                {r.city ? `${r.city}, ` : ""}
                {r.country}
              </TableCell>
              <TableCell>{r.owner ?? "—"}</TableCell>
              <TableCell className="text-right">{(r.purchase_value ?? 0).toLocaleString()}</TableCell>
              <TableCell className="text-right">{(r.current_value ?? 0).toLocaleString()}</TableCell>
              <TableCell>
                <Badge variant={statusVariant[r.status as keyof typeof statusVariant]}>{r.status}</Badge>
              </TableCell>
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
      </Table>
    </div>
  );
}
