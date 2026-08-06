import { Fragment, Suspense } from "react";

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
import { computeRunningBalances } from "@/lib/reports/ledger-balance";
import { createClient } from "@/lib/supabase/server";
import type { AccountType } from "@/types/database.types";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const DEBIT_NORMAL: AccountType[] = ["asset", "expense"];

interface LedgerRow {
  journal_entry_id: string;
  entry_date: string;
  due_date: string | null;
  voucher_type: string;
  voucher_no: string | null;
  debit_amount: number;
  credit_amount: number;
  description: string | null;
  narration: string | null;
}

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    accountIds?: string;
    accountId?: string;
    from?: string;
    to?: string;
    cur?: string;
    vtype?: string;
    q?: string;
    min?: string;
    max?: string;
  }>;
}) {
  const sp = await searchParams;
  const from = sp.from ?? startOfYear();
  const to = sp.to ?? today();
  const accountIds = (sp.accountIds ?? sp.accountId ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reportingCurrency = sp.cur ?? ""; // "" => each account's own currency
  const vtype = sp.vtype ?? "";
  const q = (sp.q ?? "").toLowerCase();
  const minAmount = sp.min ? Number(sp.min) : null;
  const maxAmount = sp.max ? Number(sp.max) : null;

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: accounts }, { data: companyCurrencies }] = await Promise.all([
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name, account_type, currency_id")
      .eq("company_id", companyId)
      .eq("is_group", false)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("account_code"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
  ]);

  type RawCurrency = { is_base_currency: boolean; currencies: { id: string; code: string } | null };
  const currencyList = ((companyCurrencies as unknown as RawCurrency[]) ?? []).filter((cc) => cc.currencies);
  const baseCurrency = currencyList.find((cc) => cc.is_base_currency)?.currencies ?? null;
  const currencyOptions = currencyList.map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));
  const codeById = new Map(currencyOptions.map((c) => [c.id, c.code] as const));

  // Conversion factor (base -> target currency) at the report's "to" date.
  const factorCache = new Map<string, number>();
  async function factorFor(currencyId: string | null): Promise<number> {
    if (!currencyId || (baseCurrency && currencyId === baseCurrency.id)) return 1;
    if (factorCache.has(currencyId)) return factorCache.get(currencyId)!;
    const { data: rate, error } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
      p_company_id: companyId,
      p_currency_id: currencyId,
      p_as_of_date: to,
    });
    // No rate configured -> leave amounts in base rather than failing the report.
    const factor = !error && rate ? 1 / (rate as number) : 1;
    factorCache.set(currencyId, factor);
    return factor;
  }

  const selectedAccounts = (accounts ?? []).filter((a) => accountIds.includes(a.id));

  type Section = {
    account: { id: string; account_code: string; account_name: string };
    currencyCode: string;
    opening: number;
    rows: (LedgerRow & { balance: number })[];
  };
  const sections: Section[] = [];

  for (const acc of selectedAccounts) {
    const isDebitNormal = DEBIT_NORMAL.includes(acc.account_type);
    const targetCurrencyId = reportingCurrency || acc.currency_id || baseCurrency?.id || null;
    const factor = await factorFor(targetCurrencyId);
    const currencyCode = (targetCurrencyId ? codeById.get(targetCurrencyId) : baseCurrency?.code) ?? "";

    const { data: priorLines } = await supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("debit_amount, credit_amount")
      .eq("company_id", companyId)
      .eq("account_id", acc.id)
      .lt("entry_date", from);
    const priorDebit = (priorLines ?? []).reduce((sum, l) => sum + l.debit_amount, 0);
    const priorCredit = (priorLines ?? []).reduce((sum, l) => sum + l.credit_amount, 0);
    const openingBase = isDebitNormal ? priorDebit - priorCredit : priorCredit - priorDebit;
    const opening = round2(openingBase * factor);

    const { data: lineRows } = await supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select(
        "journal_entry_id, entry_date, due_date, voucher_type, voucher_no, debit_amount, credit_amount, description, narration",
      )
      .eq("company_id", companyId)
      .eq("account_id", acc.id)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date")
      .order("line_no");

    let rows = ((lineRows as unknown as LedgerRow[]) ?? []).map((r) => ({
      ...r,
      debit_amount: round2(r.debit_amount * factor),
      credit_amount: round2(r.credit_amount * factor),
    }));

    // Column filters (applied to the displayed period rows).
    if (vtype) rows = rows.filter((r) => r.voucher_type === vtype);
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.voucher_no ?? "").toLowerCase().includes(q) ||
          (r.narration ?? "").toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q),
      );
    }
    if (minAmount != null) rows = rows.filter((r) => r.debit_amount + r.credit_amount >= minAmount);
    if (maxAmount != null) rows = rows.filter((r) => r.debit_amount + r.credit_amount <= maxAmount);

    sections.push({
      account: acc,
      currencyCode,
      opening,
      rows: computeRunningBalances(opening, isDebitNormal, rows),
    });
  }

  const csvRows = sections.flatMap((s) =>
    s.rows.map((r) => [
      r.entry_date,
      r.due_date ?? "",
      r.voucher_no ?? "",
      `${s.account.account_code} - ${s.account.account_name}`,
      s.currencyCode,
      r.description || r.narration || "",
      r.debit_amount,
      r.credit_amount,
      r.balance,
    ]),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">General Ledger</h1>
          <p className="text-sm text-muted-foreground">
            Posted transactions with running balances. Select one or more accounts; amounts default to each account&apos;s
            currency.
          </p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`general-ledger-${from}-to-${to}.csv`}
            headers={["Date", "Due Date", "Voucher No", "Account", "Currency", "Narration", "Debit", "Credit", "Balance"]}
            rows={csvRows}
          />
          <PrintButton />
        </div>
      </div>

      <Suspense>
        <GeneralLedgerFilters
          accounts={accounts ?? []}
          currencies={currencyOptions}
          defaultAccountIds={accountIds}
          defaultFrom={from}
          defaultTo={to}
          defaultCurrency={reportingCurrency}
          defaultVoucherType={vtype}
          defaultQuery={sp.q ?? ""}
          defaultMin={sp.min ?? ""}
          defaultMax={sp.max ?? ""}
          collapsedByDefault={selectedAccounts.length > 0}
        />
      </Suspense>

      {selectedAccounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Select one or more accounts to view their ledger.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Voucher No</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((s) => (
                <Fragment key={s.account.id}>
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={3} className="font-medium">
                      {s.account.account_code} — {s.account.account_name}{" "}
                      <span className="font-normal text-muted-foreground">({s.currencyCode})</span>
                    </TableCell>
                    <TableCell colSpan={4} className="text-right font-medium text-muted-foreground">
                      Opening balance
                    </TableCell>
                    <TableCell className="text-right font-medium">{s.opening.toLocaleString()}</TableCell>
                  </TableRow>
                  {s.rows.map((r) => (
                    <TableRow key={`${r.journal_entry_id}-${r.entry_date}-${r.voucher_no ?? ""}`}>
                      <TableCell>{r.entry_date}</TableCell>
                      <TableCell>{r.due_date ?? "—"}</TableCell>
                      <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                      <TableCell>{s.account.account_name}</TableCell>
                      <TableCell>{r.description || r.narration || "—"}</TableCell>
                      <TableCell className="text-right">
                        {r.debit_amount ? r.debit_amount.toLocaleString() : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.credit_amount ? r.credit_amount.toLocaleString() : ""}
                      </TableCell>
                      <TableCell className="text-right">{r.balance.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {s.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No transactions match the filters in this period.
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
