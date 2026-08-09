import { Suspense } from "react";

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
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { formatDate, formatMoney } from "@/lib/format";
import type { CashBankAccountSection } from "@/lib/reports/cash-bank-book";

export function CashBankBookView({
  title,
  description,
  sections,
  from,
  to,
  filenamePrefix,
}: {
  title: string;
  description: string;
  sections: CashBankAccountSection[];
  from: string;
  to: string;
  filenamePrefix: string;
}) {
  const exportRows = sections.flatMap((s) =>
    s.rows.map((r) => [
      `${s.account_code} - ${s.account_name}`,
      formatDate(r.entry_date),
      r.voucher_no ?? "",
      r.description || r.narration || "",
      r.debit_amount,
      r.credit_amount,
      r.balance,
    ]),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title={title}
        description={description}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`${filenamePrefix}-${from}-to-${to}.csv`}
              headers={["Account", "Date", "Voucher No", "Narration", "Debit", "Credit", "Balance"]}
              rows={exportRows}
            />
            <PrintButton />
          </>
        }
      />

      <Suspense>
        <DateRangeFilter defaultFrom={from} defaultTo={to} />
      </Suspense>

      {sections.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No accounts are flagged for this report yet — set the flag on the relevant accounts in Chart of Accounts.
        </p>
      )}

      {sections.map((section) => (
        <div key={section.account_id} className="space-y-2">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            <span className="font-mono text-xs text-muted-foreground">{section.account_code}</span>{" "}
            {section.account_name}
          </h2>
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher No</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={5} className="font-medium">
                    Opening balance
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {formatMoney(section.openingBalance)}
                  </TableCell>
                </TableRow>
                {section.rows.map((r) => (
                  <TableRow key={`${r.journal_entry_id}-${r.entry_date}`}>
                    <TableCell>{formatDate(r.entry_date)}</TableCell>
                    <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                    <TableCell>{r.description || r.narration || "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.debit_amount ? formatMoney(r.debit_amount) : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.credit_amount ? formatMoney(r.credit_amount) : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(r.balance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={5} className="font-medium">
                    Closing balance
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {formatMoney(section.closingBalance)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}
