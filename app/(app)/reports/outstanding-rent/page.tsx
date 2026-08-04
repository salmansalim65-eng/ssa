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

export default async function OutstandingRentPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const { data: rows } = await supabase
    .schema("reporting")
    .from("v_outstanding_rent")
    .select("*")
    .eq("company_id", companyId)
    .order("due_date");

  const totalOutstanding = (rows ?? []).reduce((sum, r) => sum + r.outstanding_balance, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outstanding Rent</h1>
          <p className="text-sm text-muted-foreground">Posted invoices with a balance still due, oldest first.</p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename="outstanding-rent.csv"
            headers={["Country", "Voucher No", "Due Date", "Asset", "Tenant", "Outstanding", "Currency", "Days Overdue"]}
            rows={(rows ?? []).map((r) => [
              r.country,
              r.voucher_no ?? "",
              r.due_date,
              `${r.asset_code} - ${r.asset_name}`,
              r.tenant_name,
              r.outstanding_balance,
              r.currency_code,
              r.days_overdue,
            ])}
          />
          <PrintButton />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Country</TableHead>
            <TableHead>Voucher No</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead>Asset</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
            <TableHead className="text-right">Days overdue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((r) => (
            <TableRow key={r.invoice_id}>
              <TableCell>
                <Badge variant="outline">{r.country}</Badge>
              </TableCell>
              <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
              <TableCell>{r.due_date}</TableCell>
              <TableCell>
                {r.asset_code} — {r.asset_name}
              </TableCell>
              <TableCell>{r.tenant_name}</TableCell>
              <TableCell className="text-right">
                {r.outstanding_balance.toLocaleString()} {r.currency_code}
              </TableCell>
              <TableCell className={`text-right ${r.days_overdue > 0 ? "text-destructive" : ""}`}>
                {r.days_overdue > 0 ? r.days_overdue : 0}
              </TableCell>
            </TableRow>
          ))}
          {(rows ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No outstanding rent.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {(rows ?? []).length > 0 && (
          <tfoot>
            <TableRow>
              <TableCell colSpan={5} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">{totalOutstanding.toLocaleString()}</TableCell>
              <TableCell />
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
