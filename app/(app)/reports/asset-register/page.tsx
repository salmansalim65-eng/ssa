import { Badge } from "@/components/ui/badge";
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
import { formatMoney } from "@/lib/format";

const statusVariant = { active: "success", inactive: "secondary", sold: "outline" } as const;

export default async function AssetRegisterPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const { data: rows } = await supabase
    .schema("reporting")
    .from("v_asset_register")
    .select("*")
    .eq("company_id", companyId)
    .order("asset_code");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Asset Register"
        description="Every registered asset, its purchase cost, and current status."
        className="print:hidden"
        actions={
          <>
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
          </>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
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
                <TableCell className="font-mono text-xs text-muted-foreground">{r.asset_code}</TableCell>
                <TableCell className="font-medium">{r.asset_name}</TableCell>
                <TableCell>{r.property_type}</TableCell>
                <TableCell>
                  {r.city ? `${r.city}, ` : ""}
                  {r.country}
                </TableCell>
                <TableCell>{r.owner ?? "—"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(r.purchase_value ?? 0)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(r.current_value ?? 0)}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant[r.status as keyof typeof statusVariant]}>{r.status}</Badge>
                </TableCell>
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
        </Table>
      </div>
    </div>
  );
}
