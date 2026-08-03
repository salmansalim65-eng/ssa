import { Suspense } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { PrintButton } from "@/components/vouchers/print-button";
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
    s.rows.map((r) => ({ ...r, account_code: s.account_code, account_name: s.account_name })),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`${filenamePrefix}-${from}-to-${to}.csv`}
            rows={exportRows}
            columns={[
              { header: "Account", accessor: (r) => `${r.account_code} - ${r.account_name}` },
              { header: "Date", accessor: (r) => r.entry_date },
              { header: "Voucher No", accessor: (r) => r.voucher_no ?? "" },
              { header: "Narration", accessor: (r) => r.description || r.narration || "" },
              { header: "Debit", accessor: (r) => r.debit_amount },
              { header: "Credit", accessor: (r) => r.credit_amount },
              { header: "Balance", accessor: (r) => r.balance },
            ]}
          />
          <PrintButton />
        </div>
      </div>

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
          <h2 className="font-medium">
            {section.account_code} — {section.account_name}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
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
                <TableCell className="text-right font-medium">{section.openingBalance.toLocaleString()}</TableCell>
              </TableRow>
              {section.rows.map((r) => (
                <TableRow key={`${r.journal_entry_id}-${r.entry_date}`}>
                  <TableCell>{r.entry_date}</TableCell>
                  <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                  <TableCell>{r.description || r.narration || "—"}</TableCell>
                  <TableCell className="text-right">{r.debit_amount ? r.debit_amount.toLocaleString() : ""}</TableCell>
                  <TableCell className="text-right">{r.credit_amount ? r.credit_amount.toLocaleString() : ""}</TableCell>
                  <TableCell className="text-right">{r.balance.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={5} className="font-medium">
                  Closing balance
                </TableCell>
                <TableCell className="text-right font-medium">{section.closingBalance.toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}
