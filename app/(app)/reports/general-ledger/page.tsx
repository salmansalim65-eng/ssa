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
import { GeneralLedgerFilters } from "@/components/reports/general-ledger-filters";
import { PrintButton } from "@/components/vouchers/print-button";
import { createClient } from "@/lib/supabase/server";
import type { AccountType } from "@/types/database.types";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const DEBIT_NORMAL: AccountType[] = ["asset", "expense"];

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string; from?: string; to?: string }>;
}) {
  const { accountId = "", from = startOfYear(), to = today() } = await searchParams;

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const { data: accounts } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_code, account_name, account_type")
    .eq("company_id", companyId)
    .eq("is_group", false)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("account_code");

  const selectedAccount = (accounts ?? []).find((a) => a.id === accountId);

  let openingBalance = 0;
  let rows: {
    journal_entry_id: string;
    entry_date: string;
    voucher_type: string;
    voucher_no: string | null;
    debit_amount: number;
    credit_amount: number;
    description: string | null;
    narration: string | null;
  }[] = [];

  if (selectedAccount) {
    const isDebitNormal = DEBIT_NORMAL.includes(selectedAccount.account_type);

    const { data: priorLines } = await supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("debit_amount, credit_amount")
      .eq("company_id", companyId)
      .eq("account_id", accountId)
      .lt("entry_date", from);

    const priorDebit = (priorLines ?? []).reduce((sum, l) => sum + l.debit_amount, 0);
    const priorCredit = (priorLines ?? []).reduce((sum, l) => sum + l.credit_amount, 0);
    openingBalance = isDebitNormal ? priorDebit - priorCredit : priorCredit - priorDebit;

    const { data: lineRows } = await supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select(
        "journal_entry_id, entry_date, voucher_type, voucher_no, debit_amount, credit_amount, description, narration",
      )
      .eq("company_id", companyId)
      .eq("account_id", accountId)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date")
      .order("line_no");

    rows = lineRows ?? [];
  }

  const isDebitNormal = selectedAccount ? DEBIT_NORMAL.includes(selectedAccount.account_type) : true;
  const rowsWithBalance = rows.reduce<(typeof rows[number] & { balance: number })[]>((acc, r) => {
    const previousBalance = acc.length > 0 ? acc[acc.length - 1].balance : openingBalance;
    const balance = previousBalance + (isDebitNormal ? r.debit_amount - r.credit_amount : r.credit_amount - r.debit_amount);
    return [...acc, { ...r, balance }];
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">General Ledger</h1>
          <p className="text-sm text-muted-foreground">Posted transactions for a single account, with a running balance.</p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`general-ledger-${accountId || "account"}.csv`}
            rows={rowsWithBalance}
            columns={[
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
        <GeneralLedgerFilters
          accounts={accounts ?? []}
          defaultAccountId={accountId}
          defaultFrom={from}
          defaultTo={to}
        />
      </Suspense>

      {!selectedAccount ? (
        <p className="text-sm text-muted-foreground">Select an account to view its ledger.</p>
      ) : (
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
              <TableCell className="text-right font-medium">{openingBalance.toLocaleString()}</TableCell>
            </TableRow>
            {rowsWithBalance.map((r) => (
              <TableRow key={`${r.journal_entry_id}-${r.entry_date}`}>
                <TableCell>{r.entry_date}</TableCell>
                <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                <TableCell>{r.description || r.narration || "—"}</TableCell>
                <TableCell className="text-right">{r.debit_amount ? r.debit_amount.toLocaleString() : ""}</TableCell>
                <TableCell className="text-right">{r.credit_amount ? r.credit_amount.toLocaleString() : ""}</TableCell>
                <TableCell className="text-right">{r.balance.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {rowsWithBalance.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No transactions in this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
