"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { gridFromText, parseBankStatement, type BankStatementLine } from "@/lib/accounting/bank-statement";
import { readWorkbook } from "@/lib/rental/xlsx";
import { gridFromPdf } from "@/lib/accounting/pdf-text";
import { reconcileBankStatement, type ReconcileResult } from "@/features/accounting/bank-reconciliation/actions";
import { createPaymentVoucher } from "@/features/accounting/vouchers/payment/actions";
import { createReceiptVoucher } from "@/features/accounting/vouchers/receipt/actions";

interface AccountOption {
  id: string;
  label: string;
  currencyId: string | null;
}

/**
 * The bank's list, held against ours.
 *
 * Three answers, in the order they matter: what is MISSING from SSA (the
 * reason anybody opens this), what is in SSA but has not reached the bank, and
 * what already agrees. The missing ones are entered from their own row —
 * the date and the amount are the bank's, so all that is left to say is which
 * account it belongs to.
 */
export function BankReconciliation({
  bankAccounts,
  allAccounts,
  currencies,
}: {
  bankAccounts: AccountOption[];
  allAccounts: AccountOption[];
  currencies: { id: string; code: string; rate: number }[];
}) {
  const [accountId, setAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [pasted, setPasted] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [entered, setEntered] = useState<Record<number, string>>({});
  const [pickFor, setPickFor] = useState<Record<number, string>>({});
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const bank = bankAccounts.find((a) => a.id === accountId);
  const currency = currencies.find((c) => c.id === bank?.currencyId) ?? currencies[0];

  function run(lines: BankStatementLine[], warnings: string[]) {
    setNotes(warnings);
    if (lines.length === 0) {
      setResult(null);
      return;
    }
    startTransition(async () => {
      const answer = await reconcileBankStatement(accountId, lines);
      if ("error" in answer) {
        setNotes([answer.error]);
        setResult(null);
        return;
      }
      setEntered({});
      setResult(answer);
    });
  }

  function readPaste() {
    const { lines, warnings } = parseBankStatement(gridFromText(pasted));
    run(lines, warnings);
  }

  async function readFile(file: File) {
    try {
      if (/\.(csv|txt|tsv)$/i.test(file.name)) {
        const { lines, warnings } = parseBankStatement(gridFromText(await file.text()));
        run(lines, warnings);
        return;
      }
      if (/\.pdf$/i.test(file.name)) {
        // A PDF has no table — only words with coordinates — so the columns
        // are read back off the page the way the eye reads them.
        const { lines, warnings } = parseBankStatement(await gridFromPdf(file));
        run(lines, warnings.concat("Read from a PDF, so check a row or two against the paper."));
        return;
      }
      const sheets = await readWorkbook(file);
      const { lines, warnings } = parseBankStatement(sheets[0].grid);
      run(lines, warnings.concat(sheets.length > 1 ? [`Read the first sheet, “${sheets[0].name}”.`] : []));
    } catch (error) {
      setNotes([`That file could not be read: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  /** Enter one missing line as a payment (money out) or a receipt (money in). */
  function enter(line: BankStatementLine, index: number) {
    const otherAccountId = pickFor[index];
    if (!otherAccountId) {
      toast.error("Pick the account this belongs to.");
      return;
    }
    if (!currency) {
      toast.error("No currency is configured for this account.");
      return;
    }
    const narration = [line.description, line.reference].filter(Boolean).join(" · ").slice(0, 500) || "From the bank statement";

    startTransition(async () => {
      const outcome =
        line.debit > 0
          ? await createPaymentVoucher({
              paymentDate: line.date,
              creditAccountId: accountId,
              costCenterId: "",
              currencyId: currency.id,
              exchangeRate: currency.rate,
              narration,
              lines: [{ accountId: otherAccountId, amount: line.debit, remarks: "" }],
            } as never)
          : await createReceiptVoucher({
              receiptDate: line.date,
              debitAccountId: accountId,
              costCenterId: "",
              currencyId: currency.id,
              exchangeRate: currency.rate,
              narration,
              lines: [{ accountId: otherAccountId, amount: line.credit, remarks: "" }],
            } as never);

      if (outcome && "error" in outcome && outcome.error) {
        toast.error(outcome.error, { duration: 15000 });
        return;
      }
      setEntered((e) => ({ ...e, [index]: line.debit > 0 ? "Payment entered" : "Receipt entered" }));
      toast.success(line.debit > 0 ? "Payment voucher created" : "Receipt voucher created");
    });
  }

  const money = (n: number) => formatMoney(n);
  const stillMissing = (result?.missing ?? []).filter((_, i) => !entered[i]).length;

  return (
    <div className="space-y-5">
      {/* ---- the statement comes in ---- */}
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Bank or cash account</label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick the account" />
              </SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.csv,.xlsx,.txt,.tsv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" disabled={!accountId || isPending} onClick={() => fileInput.current?.click()}>
            <UploadIcon /> Upload a file
          </Button>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            …or paste the statement — out of Excel, a CSV or a PDF
          </label>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder={"03/10/2026\tDEWA DUBAI\t575.00\n05/10/2026\tTOP LINE TRANSFER\t\t50,000.00"}
            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" disabled={!accountId || !pasted.trim() || isPending} onClick={readPaste}>
            {isPending ? "Reading…" : "Check against the books"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Nothing is saved by reading. Columns are found by their headings, whatever the bank calls them.
          </p>
        </div>
      </div>

      {notes.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {notes.map((note, i) => (
            <li key={i} className="flex items-start gap-2 text-amber-800 dark:text-amber-400">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              {note}
            </li>
          ))}
        </ul>
      )}

      {result && (
        <>
          <p className="text-sm text-muted-foreground">
            {formatDate(result.from)} – {formatDate(result.to)} ·{" "}
            <span className="font-medium text-foreground">{stillMissing}</span> not in SSA ·{" "}
            {result.unseen.length} not on the statement · {result.matched.length} agree
          </p>

          {/* ---- what is missing ---- */}
          <Section
            tone="destructive"
            icon={<AlertTriangleIcon className="size-4" />}
            title={`On the statement, not in SSA (${stillMissing})`}
            note="The bank has these and the books do not. Pick the account each belongs to and enter it — the date and the amount are the bank's."
            empty="Nothing on the statement is missing from the books."
            count={result.missing.length}
          >
            <table className="w-full min-w-[800px] text-sm">
              <Head cols={["Date", "Description", "Out", "In", "Account it belongs to", ""]} />
              <tbody>
                {result.missing.map((line, i) => (
                  <tr key={`${line.rowNo}-${i}`} className="border-b [&>td]:px-3 [&>td]:py-2">
                    <td className="whitespace-nowrap">{formatDate(line.date)}</td>
                    <td className="max-w-80 truncate" title={line.description}>
                      {line.description || "—"}
                      {line.reference && <span className="ml-2 text-xs text-muted-foreground">{line.reference}</span>}
                    </td>
                    <td className="text-right font-mono tabular-nums">{line.debit ? money(line.debit) : "—"}</td>
                    <td className="text-right font-mono tabular-nums">{line.credit ? money(line.credit) : "—"}</td>
                    <td>
                      {entered[i] ? (
                        <span className="text-xs text-muted-foreground">from the bank statement</span>
                      ) : (
                        <Select value={pickFor[i] ?? ""} onValueChange={(v) => setPickFor((p) => ({ ...p, [i]: v }))}>
                          <SelectTrigger className="h-8 w-full">
                            <SelectValue placeholder="Pick the account" />
                          </SelectTrigger>
                          <SelectContent>
                            {allAccounts
                              .filter((a) => a.id !== accountId)
                              .map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="text-right">
                      {entered[i] ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
                          <CheckCircle2Icon className="size-3.5" /> {entered[i]}
                        </span>
                      ) : (
                        <Button size="sm" variant="secondary" disabled={isPending} onClick={() => enter(line, i)}>
                          Add
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* ---- in SSA, not on the statement ---- */}
          <Section
            tone="muted"
            icon={<ClockIcon className="size-4" />}
            title={`In SSA, not on the statement (${result.unseen.length})`}
            note="Entered here but not yet on the bank's list — a cheque nobody has banked, or a date the bank has not reached."
            empty="Everything in the books for these dates is on the statement."
            count={result.unseen.length}
          >
            <table className="w-full min-w-[700px] text-sm">
              <Head cols={["Date", "Voucher", "Narration", "Out", "In"]} />
              <tbody>
                {result.unseen.map((row, i) => (
                  <tr key={i} className="border-b [&>td]:px-3 [&>td]:py-2">
                    <td className="whitespace-nowrap">{formatDate(row.entryDate)}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{row.voucherNo ?? "—"}</td>
                    <td className="max-w-96 truncate" title={row.narration ?? ""}>
                      {row.narration ?? "—"}
                    </td>
                    <td className="text-right font-mono tabular-nums">{row.credit ? money(row.credit) : "—"}</td>
                    <td className="text-right font-mono tabular-nums">{row.debit ? money(row.debit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* ---- what agrees ---- */}
          <Section
            tone="muted"
            icon={<CheckCircle2Icon className="size-4" />}
            title={`Already in SSA (${result.matched.length})`}
            note="Matched by amount and side, within five days either way."
            empty="Nothing on the statement matched the books."
            count={result.matched.length}
          >
            <table className="w-full min-w-[800px] text-sm">
              <Head cols={["Bank date", "Description", "Out", "In", "Voucher", "Entered"]} />
              <tbody>
                {result.matched.map((m, i) => (
                  <tr key={i} className="border-b [&>td]:px-3 [&>td]:py-2">
                    <td className="whitespace-nowrap">{formatDate(m.line.date)}</td>
                    <td className="max-w-72 truncate" title={m.line.description}>
                      {m.line.description || "—"}
                    </td>
                    <td className="text-right font-mono tabular-nums">{m.line.debit ? money(m.line.debit) : "—"}</td>
                    <td className="text-right font-mono tabular-nums">{m.line.credit ? money(m.line.credit) : "—"}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{m.voucherNo ?? "—"}</td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(m.entryDate)}
                      {m.daysApart > 0 && <span className="ml-1">({m.daysApart}d apart)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  );
}

function Head({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b bg-muted/40 [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
        {cols.map((c, i) => (
          <th key={i} className={cn(i >= 2 && i <= 3 ? "text-right" : "text-left")}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Section({
  tone,
  icon,
  title,
  note,
  empty,
  count,
  children,
}: {
  tone: "destructive" | "muted";
  icon: React.ReactNode;
  title: string;
  note: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="border-b px-3 py-2.5">
        <p
          className={cn(
            "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide",
            tone === "destructive" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {icon}
          {title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </div>
      {count === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}
