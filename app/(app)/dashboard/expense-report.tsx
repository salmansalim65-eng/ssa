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

function monthName(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthShort(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * Where the Expense KHI money came from and where it went.
 *
 * Both halves read the same two accounts the card is built on — money INTO the
 * float bank account, and the net of the KHI EXPENSE group — so the report can
 * never disagree with the card above it. The spend is taken off the LEDGER
 * rather than off expense vouchers alone, because money spent through a payment
 * voucher is just as gone.
 *
 * The detail covers the CURRENT MONTH, which is the question being asked day to
 * day. Nothing is discarded, though: every earlier month keeps its row in the
 * history table, with the balance running forward through them, because a float
 * carries over and August's leftover is what September is spending.
 */
export async function ExpenseReport({
  companyId,
  month,
  bankAccountId,
  expenseAccountIds,
  bankAccountName,
  expenseGroupName,
}: {
  companyId: string;
  /** The month being detailed, as YYYY-MM. */
  month: string;
  bankAccountId: string | null;
  expenseAccountIds: string[];
  bankAccountName: string;
  expenseGroupName: string;
}) {
  const supabase = await createClient();

  // No date filter: the history table needs every month, and the month's own
  // figures are cut from the same rows rather than fetched twice.
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
          .order("entry_date", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const allReceipts = (receiptRows ?? [])
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

  const allLines: Line[] = (spendRows ?? [])
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

  const inMonth = (date: string) => date.slice(0, 7) === month;
  const receipts = allReceipts.filter((r) => inMonth(r.date));
  const lines = allLines.filter((l) => inMonth(l.date));

  const receivedTotal = receipts.reduce((s, r) => s + r.amount, 0);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const currency = allLines[0]?.currency ?? allReceipts[0]?.currency ?? "";

  // Month by month, oldest first, with the balance running forward — the float
  // that August left behind is what September opens with.
  const monthlyMap = new Map<string, { received: number; spent: number }>();
  for (const r of allReceipts) {
    const key = r.date.slice(0, 7);
    const row = monthlyMap.get(key) ?? { received: 0, spent: 0 };
    row.received += r.amount;
    monthlyMap.set(key, row);
  }
  for (const l of allLines) {
    const key = l.date.slice(0, 7);
    const row = monthlyMap.get(key) ?? { received: 0, spent: 0 };
    row.spent += l.amount;
    monthlyMap.set(key, row);
  }
  const history = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .reduce<{ month: string; received: number; spent: number; balance: number }[]>((rows, [key, row]) => {
      const previous = rows[rows.length - 1]?.balance ?? 0;
      rows.push({ month: key, ...row, balance: previous + row.received - row.spent });
      return rows;
    }, [])
    .reverse();
  // Newest first now, so the running balance to date is the first row's.
  const balanceInHand = history[0]?.balance ?? 0;

  // Expense vouchers that never reached the ledger. The ledger holds POSTED
  // entries only, so a voucher stuck in draft is invisible everywhere above —
  // which reads as "nothing was spent" when in fact the spending is sitting one
  // click away from being posted. Listing them is the difference between an
  // empty report and a report that says what to do next.
  const { data: allVouchers } = await supabase
    .schema("accounting")
    .from("expense_vouchers")
    .select("id, voucher_no, expense_date, total_amount, journal_entry_id")
    .eq("company_id", companyId)
    .order("expense_date", { ascending: false });
  const voucherJournalIds = (allVouchers ?? []).map((v) => v.journal_entry_id as string).filter(Boolean);
  const { data: voucherStatuses } = voucherJournalIds.length
    ? await supabase
        .schema("accounting")
        .from("journal_entries")
        .select("id, status")
        .in("id", voucherJournalIds)
    : { data: [] };
  const statusByJournal = new Map((voucherStatuses ?? []).map((e) => [e.id as string, e.status as string]));
  const unposted = (allVouchers ?? [])
    .map((v) => ({
      id: v.id as string,
      date: v.expense_date as string,
      voucherNo: (v.voucher_no as string | null) ?? null,
      amount: Number(v.total_amount) || 0,
      status: statusByJournal.get(v.journal_entry_id as string) ?? "draft",
    }))
    .filter((v) => v.status !== "posted");

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

  const nothingAtAll = history.length === 0 && unposted.length === 0;

  return (
    <Card className="border-ledger-dark/40">
      <CardHeader className="border-b pb-4">
        <CardTitle>Expense KHI — {monthName(month)}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Received into {bankAccountName}, spent under {expenseGroupName}.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 pt-4">
        {nothingAtAll ? (
          <div className="space-y-1 py-6 text-center text-sm text-muted-foreground">
            <p>Nothing received or spent yet.</p>
            <p>
              Only posted entries count: money debited to {bankAccountName}, and spend under the{" "}
              {expenseGroupName} group.
            </p>
          </div>
        ) : (
          <>
            {unposted.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Not posted yet — {unposted.length} voucher{unposted.length === 1 ? "" : "s"}
                </h3>
                <p className="mb-2 text-sm text-muted-foreground">
                  These are not in the ledger, so they are not counted anywhere below. Open one and
                  post it.
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                        <th className="w-12">Sno</th>
                        <th className="w-28">Date</th>
                        <th className="w-32">Voucher</th>
                        <th className="w-28">Status</th>
                        <th className="w-32 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unposted.map((v, i) => (
                        <tr key={v.id} className="border-b last:border-0 [&_td]:px-3 [&_td]:py-2">
                          <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="whitespace-nowrap tabular-nums">{formatDate(v.date)}</td>
                          <td className="whitespace-nowrap">
                            <Link
                              href={`/accounting/vouchers/expense_voucher/${v.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {formatVoucherNo(v.voucherNo) || "Open"}
                            </Link>
                          </td>
                          <td className="capitalize text-muted-foreground">{v.status.replace("_", " ")}</td>
                          <td className="text-right font-medium tabular-nums">{formatMoney(v.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <Figure label={`Received in ${monthShort(month)}`} value={receivedTotal} currency={currency} />
              <Figure label={`Spent in ${monthShort(month)}`} value={total} currency={currency} />
              <Figure label="Balance in hand" value={balanceInHand} currency={currency} strong />
            </div>

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
                            <VoucherLink type={r.voucherType} id={r.voucherId} no={r.voucherNo} />
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

            {history.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">History — month by month</h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                        <th>Month</th>
                        <th className="w-32 text-right">Received</th>
                        <th className="w-32 text-right">Spent</th>
                        <th className="w-32 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr
                          key={h.month}
                          className={
                            h.month === month
                              ? "border-b bg-ledger/10 font-medium last:border-0 [&_td]:px-3 [&_td]:py-2"
                              : "border-b last:border-0 [&_td]:px-3 [&_td]:py-2"
                          }
                        >
                          <td>{monthShort(h.month)}</td>
                          <td className="text-right tabular-nums">{formatMoney(h.received)}</td>
                          <td className="text-right tabular-nums">{formatMoney(h.spent)}</td>
                          <td className="text-right font-medium tabular-nums">{formatMoney(h.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One headline figure with its label — the three the card summarises. */
function Figure({
  label,
  value,
  currency,
  strong,
}: {
  label: string;
  value: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={strong ? "text-xl font-bold tabular-nums" : "text-xl font-semibold tabular-nums"}>
        {currency && <span className="mr-1 text-sm font-medium text-muted-foreground">{currency}</span>}
        {formatMoney(value)}
      </div>
    </div>
  );
}

/** A voucher number that opens its own document, whatever type recorded it. */
function VoucherLink({ type, id, no }: { type: string | null; id: string | null; no: string | null }) {
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
