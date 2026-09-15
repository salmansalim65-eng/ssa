import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatAccountCode, formatDate, formatMoney, formatVoucherNo } from "@/lib/format";

type Line = {
  amount: number;
  accountCode: string;
  accountName: string;
  tagName: string | null;
  remarks: string | null;
  voucherId: string;
  voucherNo: string | null;
  date: string;
  currency: string;
};

type Group = { key: string; label: string; sub?: string; total: number; count: number };

/**
 * Where the Expense KHI money went: the same spend read two ways.
 *
 * Account-wise answers "which head", tag-wise answers "which activity" — a
 * plumber's bill is an account (Repairs) and a tag (Maintenance) at once, and
 * the two questions are asked by different people. Both totals come off the
 * SAME lines, so they always add up to the same figure.
 *
 * Only POSTED vouchers count, because that is what the card's Spent figure
 * reads off the ledger. A draft is not money out yet.
 */
export async function ExpenseReport({ companyId, year }: { companyId: string; year: number }) {
  const supabase = await createClient();

  const { data: vouchers } = await supabase
    .schema("accounting")
    .from("expense_vouchers")
    .select(
      "id, voucher_no, expense_date, journal_entry_id, currency_id, lines:expense_voucher_lines(amount, remarks, account_id, tag_id)",
    )
    .eq("company_id", companyId)
    .gte("expense_date", `${year}-01-01`)
    .lte("expense_date", `${year}-12-31`)
    .order("expense_date", { ascending: false });

  const rows = vouchers ?? [];
  const journalIds = rows.map((v) => v.journal_entry_id as string).filter(Boolean);
  const { data: entries } = journalIds.length
    ? await supabase
        .schema("accounting")
        .from("journal_entries")
        .select("id, status")
        .in("id", journalIds)
    : { data: [] };
  const postedJournals = new Set(
    (entries ?? []).filter((e) => e.status === "posted").map((e) => e.id as string),
  );
  const posted = rows.filter((v) => postedJournals.has(v.journal_entry_id as string));

  // Only the names actually referenced are looked up — a company can have a
  // long chart of accounts and a long tag list, and this report needs neither
  // in full.
  const accountIds = [
    ...new Set(posted.flatMap((v) => (v.lines ?? []).map((l) => l.account_id as string))),
  ];
  const tagIds = [
    ...new Set(
      posted.flatMap((v) => (v.lines ?? []).map((l) => l.tag_id as string | null).filter(Boolean)),
    ),
  ] as string[];
  const currencyIds = [...new Set(posted.map((v) => v.currency_id as string))];

  const [{ data: accounts }, { data: tags }, { data: currencies }] = await Promise.all([
    accountIds.length
      ? supabase
          .schema("accounting")
          .from("chart_of_accounts")
          .select("id, account_code, account_name")
          .in("id", accountIds)
      : Promise.resolve({ data: [] }),
    tagIds.length
      ? supabase.schema("core").from("tags").select("id, name").in("id", tagIds)
      : Promise.resolve({ data: [] }),
    currencyIds.length
      ? supabase.schema("core").from("currencies").select("id, code").in("id", currencyIds)
      : Promise.resolve({ data: [] }),
  ]);
  const accountById = new Map(
    (accounts ?? []).map((a) => [
      a.id as string,
      { code: (a.account_code as string) ?? "", name: (a.account_name as string) ?? "" },
    ]),
  );
  const tagById = new Map((tags ?? []).map((t) => [t.id as string, t.name as string]));
  const currencyById = new Map((currencies ?? []).map((c) => [c.id as string, c.code as string]));

  const lines: Line[] = posted.flatMap((v) =>
    (v.lines ?? []).map((l) => {
      const account = accountById.get(l.account_id as string);
      return {
        amount: Number(l.amount) || 0,
        accountCode: account?.code ?? "",
        accountName: account?.name ?? "—",
        tagName: l.tag_id ? (tagById.get(l.tag_id as string) ?? null) : null,
        remarks: (l.remarks as string | null) ?? null,
        voucherId: v.id as string,
        voucherNo: (v.voucher_no as string | null) ?? null,
        date: v.expense_date as string,
        currency: currencyById.get(v.currency_id as string) ?? "",
      };
    }),
  );

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const currency = lines[0]?.currency ?? "";

  function groupBy(pick: (l: Line) => { key: string; label: string; sub?: string }): Group[] {
    const map = new Map<string, Group>();
    for (const line of lines) {
      const { key, label, sub } = pick(line);
      const existing = map.get(key);
      if (existing) {
        existing.total += line.amount;
        existing.count += 1;
      } else {
        map.set(key, { key, label, sub, total: line.amount, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  const byAccount = groupBy((l) => ({
    key: l.accountCode || l.accountName,
    label: l.accountName,
    sub: formatAccountCode(l.accountCode),
  }));
  // Untagged spend gets its own row rather than being dropped: a tag-wise report
  // that silently loses lines would not add up to the account-wise one.
  const byTag = groupBy((l) => ({ key: l.tagName ?? "~untagged", label: l.tagName ?? "Untagged" }));

  return (
    <Card className="border-ledger-dark/40">
      <CardHeader className="border-b pb-4">
        <CardTitle>Expense KHI — {year}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-4">
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No posted expense vouchers this year.
          </p>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Breakdown title="Account-wise" groups={byAccount} total={total} currency={currency} />
              <Breakdown title="Tag-wise" groups={byTag} total={total} currency={currency} />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Expense lines</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                      <th className="w-12">Sno</th>
                      <th className="w-28">Date</th>
                      <th className="w-28">Voucher</th>
                      <th>Account</th>
                      <th className="w-40">Tag</th>
                      <th className="w-40">Remarks</th>
                      <th className="w-32 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr
                        key={`${l.voucherId}-${i}`}
                        className="border-b last:border-0 [&_td]:px-3 [&_td]:py-2"
                      >
                        <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="whitespace-nowrap tabular-nums">{formatDate(l.date)}</td>
                        <td className="whitespace-nowrap">
                          <Link
                            href={`/accounting/vouchers/expense_voucher/${l.voucherId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {formatVoucherNo(l.voucherNo) || "—"}
                          </Link>
                        </td>
                        <td>{l.accountName}</td>
                        <td className="text-muted-foreground">{l.tagName ?? "—"}</td>
                        <td className="text-muted-foreground">{l.remarks ?? ""}</td>
                        <td className="text-right font-medium tabular-nums">{formatMoney(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-muted/30 font-semibold [&_td]:px-3 [&_td]:py-2">
                      <td colSpan={6}>Total</td>
                      <td className="text-right tabular-nums">
                        {currency && <span className="mr-1 text-xs font-medium">{currency}</span>}
                        {formatMoney(total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One breakdown table: the same total, grouped by whatever `groups` was cut on. */
function Breakdown({
  title,
  groups,
  total,
  currency,
}: {
  title: string;
  groups: Group[];
  total: number;
  currency: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
              <th>{title === "Tag-wise" ? "Tag" : "Account"}</th>
              <th className="w-16 text-right">Lines</th>
              <th className="w-32 text-right">Amount</th>
              <th className="w-16 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-b last:border-0 [&_td]:px-3 [&_td]:py-2">
                <td>
                  <span className="font-medium">{g.label}</span>
                  {g.sub && <span className="ml-2 text-xs text-muted-foreground">{g.sub}</span>}
                </td>
                <td className="text-right tabular-nums text-muted-foreground">{g.count}</td>
                <td className="text-right font-medium tabular-nums">{formatMoney(g.total)}</td>
                <td className="text-right tabular-nums text-muted-foreground">
                  {total ? Math.round((g.total / total) * 100) : 0}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-muted/30 font-semibold [&_td]:px-3 [&_td]:py-2">
              <td>Total</td>
              <td />
              <td className="text-right tabular-nums">
                {currency && <span className="mr-1 text-xs font-medium">{currency}</span>}
                {formatMoney(total)}
              </td>
              <td className="text-right tabular-nums">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
