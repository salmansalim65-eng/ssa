import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatAccountCode, formatDate, formatMoney, formatVoucherNo } from "@/lib/format";

type Line = {
  key: string;
  amount: number;
  accountCode: string;
  accountName: string;
  tagName: string | null;
  remarks: string | null;
  voucherType: string | null;
  voucherId: string | null;
  voucherNo: string | null;
  date: string;
  currency: string;
};

type Group = { key: string; label: string; sub?: string; total: number; count: number };

/**
 * Where the Expense KHI money came from and where it went.
 *
 * Both halves read the same two accounts the card is built on — money INTO the
 * float bank account, and the net of the KHI EXPENSE group — so the report can
 * never disagree with the card above it. The spend is taken off the LEDGER
 * rather than off expense vouchers alone, because money spent through a payment
 * voucher is just as gone.
 *
 * The spend is then read two ways. Account-wise answers "which head",
 * tag-wise answers "which activity" — a plumber's bill is Repairs and
 * Maintenance at once, and the two questions get asked by different people.
 * Tags live on expense-voucher lines only, so anything else lands under
 * Untagged and the two breakdowns still total the same.
 */
export async function ExpenseReport({
  companyId,
  year,
  bankAccountId,
  expenseAccountIds,
  bankAccountName,
  expenseGroupName,
}: {
  companyId: string;
  year: number;
  bankAccountId: string | null;
  expenseAccountIds: string[];
  bankAccountName: string;
  expenseGroupName: string;
}) {
  const supabase = await createClient();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [{ data: receiptRows }, { data: spendRows }] = await Promise.all([
    bankAccountId
      ? supabase
          .schema("reporting")
          .from("v_ledger_entries")
          .select(
            "journal_entry_id, line_no, entry_date, voucher_no, voucher_type, voucher_id, doc_debit_amount, currency_code",
          )
          .eq("company_id", companyId)
          .eq("account_id", bankAccountId)
          .gte("entry_date", from)
          .lte("entry_date", to)
          .order("entry_date", { ascending: false })
      : Promise.resolve({ data: [] }),
    expenseAccountIds.length
      ? supabase
          .schema("reporting")
          .from("v_ledger_entries")
          .select(
            "journal_entry_id, line_no, entry_date, voucher_no, voucher_type, voucher_id, account_id, account_code, account_name, doc_debit_amount, doc_credit_amount, currency_code",
          )
          .eq("company_id", companyId)
          .in("account_id", expenseAccountIds)
          .gte("entry_date", from)
          .lte("entry_date", to)
          .order("entry_date", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const receipts = (receiptRows ?? [])
    .map((r) => ({
      key: `${r.journal_entry_id}-${r.line_no}`,
      date: r.entry_date as string,
      voucherNo: (r.voucher_no as string | null) ?? null,
      voucherType: (r.voucher_type as string | null) ?? null,
      voucherId: (r.voucher_id as string | null) ?? null,
      amount: Number(r.doc_debit_amount) || 0,
      currency: (r.currency_code as string | null) ?? "",
    }))
    .filter((r) => r.amount > 0);
  const receivedTotal = receipts.reduce((s, r) => s + r.amount, 0);

  // Tags and remarks are written on expense-voucher lines, not on the ledger.
  // A ledger line is matched back to one by its journal entry, account and
  // amount — and only when that combination is unique inside the entry, so a
  // voucher with two identical lines never has a tag guessed onto the wrong one.
  const journalIds = [...new Set((spendRows ?? []).map((r) => r.journal_entry_id as string))];
  const { data: voucherRows } = journalIds.length
    ? await supabase
        .schema("accounting")
        .from("expense_vouchers")
        .select("journal_entry_id, lines:expense_voucher_lines(account_id, amount, remarks, tag_id)")
        .eq("company_id", companyId)
        .in("journal_entry_id", journalIds)
    : { data: [] };

  const detailByKey = new Map<string, { tagId: string | null; remarks: string | null } | null>();
  for (const v of voucherRows ?? []) {
    for (const l of v.lines ?? []) {
      const key = `${v.journal_entry_id}|${l.account_id}|${Number(l.amount)}`;
      // A second line with the same key makes the match ambiguous: drop both.
      if (detailByKey.has(key)) detailByKey.set(key, null);
      else
        detailByKey.set(key, {
          tagId: (l.tag_id as string | null) ?? null,
          remarks: (l.remarks as string | null) ?? null,
        });
    }
  }

  const tagIds = [
    ...new Set(
      [...detailByKey.values()].map((d) => d?.tagId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: tags } = tagIds.length
    ? await supabase.schema("core").from("tags").select("id, name").in("id", tagIds)
    : { data: [] };
  const tagById = new Map((tags ?? []).map((t) => [t.id as string, t.name as string]));

  const lines: Line[] = (spendRows ?? [])
    .map((r) => {
      const amount = Number(r.doc_debit_amount) - Number(r.doc_credit_amount);
      const detail = detailByKey.get(`${r.journal_entry_id}|${r.account_id}|${amount}`) ?? null;
      return {
        key: `${r.journal_entry_id}-${r.line_no}`,
        amount,
        accountCode: (r.account_code as string | null) ?? "",
        accountName: (r.account_name as string | null) ?? "—",
        tagName: detail?.tagId ? (tagById.get(detail.tagId) ?? null) : null,
        remarks: detail?.remarks ?? null,
        voucherType: (r.voucher_type as string | null) ?? null,
        voucherId: (r.voucher_id as string | null) ?? null,
        voucherNo: (r.voucher_no as string | null) ?? null,
        date: r.entry_date as string,
        currency: (r.currency_code as string | null) ?? "",
      };
    })
    .filter((l) => l.amount !== 0);

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const currency = lines[0]?.currency ?? receipts[0]?.currency ?? "";

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
  const byTag = groupBy((l) => ({ key: l.tagName ?? "~untagged", label: l.tagName ?? "Untagged" }));

  const nothingToShow = receipts.length === 0 && lines.length === 0;

  return (
    <Card className="border-ledger-dark/40">
      <CardHeader className="border-b pb-4">
        <CardTitle>Expense KHI — {year}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Received into {bankAccountName}, spent under {expenseGroupName}.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 pt-4">
        {nothingToShow ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing received or spent this year.
          </p>
        ) : (
          <>
            {receipts.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Received — money into {bankAccountName}
                </h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                        <th className="w-12">Sno</th>
                        <th className="w-28">Date</th>
                        <th className="w-32">Voucher</th>
                        <th className="w-32 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.map((r, i) => (
                        <tr key={r.key} className="border-b last:border-0 [&_td]:px-3 [&_td]:py-2">
                          <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="whitespace-nowrap tabular-nums">{formatDate(r.date)}</td>
                          <td className="whitespace-nowrap">
                            <VoucherLink
                              type={r.voucherType}
                              id={r.voucherId}
                              no={r.voucherNo}
                            />
                          </td>
                          <td className="text-right font-medium tabular-nums">{formatMoney(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 bg-muted/30 font-semibold [&_td]:px-3 [&_td]:py-2">
                        <td colSpan={3}>Total received</td>
                        <td className="text-right tabular-nums">
                          {currency && <span className="mr-1 text-xs font-medium">{currency}</span>}
                          {formatMoney(receivedTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {lines.length > 0 && (
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
                          <th className="w-32">Voucher</th>
                          <th>Account</th>
                          <th className="w-40">Tag</th>
                          <th className="w-40">Remarks</th>
                          <th className="w-32 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={l.key} className="border-b last:border-0 [&_td]:px-3 [&_td]:py-2">
                            <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                            <td className="whitespace-nowrap tabular-nums">{formatDate(l.date)}</td>
                            <td className="whitespace-nowrap">
                              <VoucherLink type={l.voucherType} id={l.voucherId} no={l.voucherNo} />
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
                          <td colSpan={6}>Total spent</td>
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

            <div className="flex items-baseline justify-between gap-3 rounded-md border bg-muted/30 px-4 py-3">
              <span className="text-sm font-medium text-muted-foreground">Balance left to spend</span>
              <span className="text-lg font-bold tabular-nums">
                {currency && <span className="mr-1 text-sm font-medium">{currency}</span>}
                {formatMoney(receivedTotal - total)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A voucher number that opens its own document, whatever type recorded it. */
function VoucherLink({
  type,
  id,
  no,
}: {
  type: string | null;
  id: string | null;
  no: string | null;
}) {
  const label = formatVoucherNo(no) || "—";
  if (!type || !id) return <span className="font-medium">{label}</span>;
  return (
    <Link href={`/accounting/vouchers/${type}/${id}`} className="font-medium text-primary hover:underline">
      {label}
    </Link>
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
