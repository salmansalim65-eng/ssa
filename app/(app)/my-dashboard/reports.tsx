import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { resolveExpenseKhiAccounts } from "@/lib/accounting/expense-khi";

/**
 * SSA's own headline figures, as cards.
 *
 * Every one is the SAME measure a screen in SSA already shows, read the same
 * way — rent outstanding is the Rent Balance card's footer, awaiting approval
 * is what the header bell counts, the expense float is the Expense KHI card.
 * Two screens quoting one number differently is the bug this report would
 * otherwise invent, so nothing here is derived afresh.
 *
 * Only SSA's figures. MBL's and RMI's live in their own databases, which this
 * app cannot read; a card showing them would have to be made up.
 */
export function MyDashboardReports({ companyId }: { companyId: string }) {
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <Cards companyId={companyId} />
    </Suspense>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-lg border bg-card" />
      ))}
    </div>
  );
}

/** One figure, or several when the money sits in more than one currency. */
function ReportCard({
  label,
  lines,
  tone,
}: {
  label: string;
  lines: { key: string; value: string }[];
  tone?: "destructive";
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-xs">
      <p className="text-sm text-muted-foreground">{label}</p>
      {lines.length === 0 ? (
        <p className="mt-1 text-2xl font-bold tabular-nums text-muted-foreground">—</p>
      ) : (
        <div className="mt-1 space-y-0.5">
          {lines.map((l) => (
            <p
              key={l.key}
              className={cn(
                "text-2xl font-bold tabular-nums",
                tone === "destructive" ? "text-destructive" : "text-foreground",
              )}
            >
              {l.value}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

async function Cards({ companyId }: { companyId: string }) {
  const supabase = await createClient();

  const { data: chart } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, parent_id, account_name")
    .eq("company_id", companyId);
  const khi = resolveExpenseKhiAccounts(chart ?? []);

  const [{ data: currencies }, { data: rent }, { data: cashBank }, { count: pending }, { data: khiSpend }, { data: khiIn }] =
    await Promise.all([
      supabase.schema("core").from("currencies").select("code, symbol"),
      supabase
        .schema("reporting")
        .from("v_rental_income")
        .select("net_outstanding, currency_code")
        .eq("company_id", companyId),
      supabase
        .schema("reporting")
        .from("v_ledger_entries")
        .select("doc_debit_amount, doc_credit_amount, currency_code")
        .eq("company_id", companyId)
        .or("is_cash.eq.true,is_bank.eq.true"),
      supabase
        .schema("accounting")
        .from("journal_entries")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "pending"),
      khi.expenseIds.size
        ? supabase
            .schema("reporting")
            .from("v_ledger_entries")
            .select("doc_debit_amount, doc_credit_amount, currency_code")
            .eq("company_id", companyId)
            .in("account_id", [...khi.expenseIds])
        : Promise.resolve({ data: [] }),
      khi.bankId
        ? supabase
            .schema("reporting")
            .from("v_ledger_entries")
            .select("doc_debit_amount, currency_code")
            .eq("company_id", companyId)
            .eq("account_id", khi.bankId)
        : Promise.resolve({ data: [] }),
    ]);

  const symbol = new Map((currencies ?? []).map((c) => [c.code as string, (c.symbol as string) || (c.code as string)]));
  const money = (code: string, n: number) => `${symbol.get(code) ?? code} ${formatMoney(n)}`;

  /** Sums by currency, dropping anything that rounds to nothing. */
  const byCurrency = (rows: { currency_code: unknown }[], amount: (r: never) => number) => {
    const totals = new Map<string, number>();
    for (const r of rows) {
      const code = (r.currency_code as string | null) ?? "";
      totals.set(code, (totals.get(code) ?? 0) + amount(r as never));
    }
    return [...totals.entries()]
      .filter(([, n]) => Math.abs(n) >= 0.5)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([code, n]) => ({ key: code, value: money(code, n) }));
  };

  const net = (r: { doc_debit_amount: unknown; doc_credit_amount: unknown }) =>
    Number(r.doc_debit_amount) - Number(r.doc_credit_amount);

  const rentLines = byCurrency(rent ?? [], (r: { net_outstanding: unknown }) => Number(r.net_outstanding));
  const cashLines = byCurrency(cashBank ?? [], net);
  // Received into the float bank, less what the KHI EXPENSE group has spent —
  // the same subtraction the Expense KHI card makes.
  const spentByCode = new Map<string, number>();
  for (const r of khiSpend ?? []) {
    const code = (r.currency_code as string | null) ?? "";
    spentByCode.set(code, (spentByCode.get(code) ?? 0) + net(r));
  }
  const floatByCode = new Map<string, number>();
  for (const r of khiIn ?? []) {
    const code = (r.currency_code as string | null) ?? "";
    floatByCode.set(code, (floatByCode.get(code) ?? 0) + Number(r.doc_debit_amount));
  }
  for (const [code, spent] of spentByCode) floatByCode.set(code, (floatByCode.get(code) ?? 0) - spent);
  const floatLines = [...floatByCode.entries()]
    .filter(([, n]) => Math.abs(n) >= 0.5)
    .map(([code, n]) => ({ key: code, value: money(code, n) }));

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <ReportCard label="Rent outstanding" lines={rentLines} tone="destructive" />
      <ReportCard label="Cash & bank" lines={cashLines} />
      <ReportCard
        label="Awaiting approval"
        lines={[{ key: "count", value: (pending ?? 0).toLocaleString() }]}
      />
      <ReportCard label="Expense KHI balance" lines={floatLines} />
    </div>
  );
}
