"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, FileTextIcon, ListPlusIcon, PlusIcon, ScaleIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountCombobox, type AccountOption } from "@/components/vouchers/account-combobox";
import { type CurrencyOption } from "@/components/vouchers/currency-select";
import { DateInput } from "@/components/vouchers/date-input";
import { cn } from "@/lib/utils";
import { buildAccountCurrency } from "@/lib/vouchers/account-currency";
import { blankAmount, amountValue } from "@/lib/forms/amount";
import {
  createMultiCurrencyJournal,
  updateMultiCurrencyJournal,
} from "@/features/accounting/vouchers/multi-currency-journal/actions";
import {
  multiCurrencyJournalSchema,
  type MultiCurrencyJournalFormValues,
  type MultiCurrencyJournalInput,
} from "@/features/accounting/vouchers/multi-currency-journal/schemas";

export interface CostCenterOption {
  id: string;
  name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function MultiCurrencyJournalForm({
  accounts,
  currencies,
  costCenters,
  voucherId,
  initialValues,
}: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
  voucherId?: string;
  initialValues?: MultiCurrencyJournalFormValues;
}) {
  const router = useRouter();
  const isEdit = !!voucherId;
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const defaultCurrency = currencies[0]?.id ?? "";
  const defaultRate = currencies[0]?.rate ?? 1;
  const emptyLine = (side: "debit" | "credit") => ({
    costCenterId: "",
    accountId: "",
    side,
    currencyId: defaultCurrency,
    exchangeRate: defaultRate,
    amount: blankAmount,
  });

  const form = useForm<MultiCurrencyJournalFormValues, unknown, MultiCurrencyJournalInput>({
    resolver: zodResolver(multiCurrencyJournalSchema),
    defaultValues: initialValues ?? {
      entryDate: today(),
      narration: "",
      lines: [emptyLine("debit"), emptyLine("credit")],
    },
  });

  const rateById = new Map(currencies.map((c) => [c.id, c.rate ?? 1] as const));
  const codeOf = (id: string) => currencies.find((c) => c.id === id)?.code ?? "";

  // Each line carries its own currency here (that is the point of this voucher),
  // so an account sets the currency of ITS line only — and the account lists stay
  // unfiltered, since mixing currencies across lines is exactly what's wanted.
  const currencyOf = useMemo(() => buildAccountCurrency(accounts, currencies), [accounts, currencies]);
  function applyLineAccountCurrency(index: number, accountId: string) {
    const cur = currencyOf(accountId);
    if (!cur || !rateById.has(cur)) return;
    form.setValue(`lines.${index}.currencyId`, cur, { shouldValidate: true });
    form.setValue(`lines.${index}.exchangeRate`, rateById.get(cur) ?? 1, { shouldValidate: true });
  }

  // Cross-rate helper: "1 [A] = x [B]". Applying it makes A the reference
  // (rate 1) and every B line rate = 1 / x — so the user enters just one number
  // (e.g. 1 DHR = 77.5 RS) instead of the per-line to-base rates.
  const [crossA, setCrossA] = useState(currencies[0]?.id ?? "");
  const [crossB, setCrossB] = useState(currencies[1]?.id ?? currencies[0]?.id ?? "");
  const [crossVal, setCrossVal] = useState("");

  function applyCrossRate() {
    const x = Number(crossVal);
    if (!crossA || !crossB || crossA === crossB) {
      toast.error("Pick two different currencies.");
      return;
    }
    if (!(x > 0)) {
      toast.error("Enter the rate, e.g. 77.5.");
      return;
    }
    const other = Math.round((1 / x) * 1e6) / 1e6;
    const rows = form.getValues("lines");
    rows.forEach((l, i) => {
      if (l.currencyId === crossA)
        form.setValue(`lines.${i}.exchangeRate`, 1, { shouldValidate: true, shouldDirty: true });
      else if (l.currencyId === crossB)
        form.setValue(`lines.${i}.exchangeRate`, other, { shouldValidate: true, shouldDirty: true });
    });
    toast.success(`Rates set — 1 ${codeOf(crossA)} = ${x} ${codeOf(crossB)}`);
  }

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });

  // Running base-currency totals so the user can see the entry balance as they
  // type (base = amount × rate). Balanced when debit total = credit total.
  let baseDebit = 0;
  let baseCredit = 0;
  for (const l of watchedLines ?? []) {
    const base = round2((Number(l?.amount) || 0) * (Number(l?.exchangeRate) || 0));
    if (l?.side === "credit") baseCredit += base;
    else baseDebit += base;
  }
  const diff = round2(baseDebit - baseCredit);
  const balanced = baseDebit > 0 && Math.abs(diff) < 0.01;

  // Auto-balance: fill THIS line's amount so the whole entry balances in the
  // base currency — amount = (opposite-side base − same-side other base) ÷ this
  // line's rate. So you type the amount you know on one side (e.g. 4,000,000
  // RS), then click ⇄ on the other line (its currency + rate set) to get the
  // matching amount without hand-calculating.
  function autoBalance(index: number) {
    const rows = form.getValues("lines");
    const row = rows[index];
    const rate = Number(row?.exchangeRate) || 0;
    if (!rate) {
      toast.error("Set this line's currency and rate first.");
      return;
    }
    let oppositeBase = 0;
    let sameOtherBase = 0;
    rows.forEach((l, i) => {
      if (i === index) return;
      const base = round2((Number(l.amount) || 0) * (Number(l.exchangeRate) || 0));
      if (l.side === row.side) sameOtherBase += base;
      else oppositeBase += base;
    });
    const targetBase = round2(oppositeBase - sameOtherBase);
    if (targetBase <= 0) {
      toast.error("Fill the other side's amount first, then auto-balance.");
      return;
    }
    form.setValue(`lines.${index}.amount`, round2(targetBase / rate), {
      shouldValidate: true,
      shouldDirty: true,
    });
  }

  function onSubmit(values: MultiCurrencyJournalInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateMultiCurrencyJournal(voucherId!, values)
        : await createMultiCurrencyJournal(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success(isEdit ? "Multi-currency journal updated" : "Multi-currency journal created");
      router.push(`/accounting/vouchers/multi_currency_journal/${isEdit ? voucherId : result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Document header */}
        <FormSection
          title="Document information"
          description="Each line carries its own currency and conversion rate; the entry balances in the base currency."
          icon={FileTextIcon}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormItem>
              <FormLabel>Document No.</FormLabel>
              <Input value="Auto" disabled readOnly />
            </FormItem>
            <FormField
              control={form.control}
              name="entryDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <DateInput {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="narration"
              render={({ field }) => (
                <FormItem className="sm:col-span-2 lg:col-span-1">
                  <FormLabel>Narration</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </FormSection>

        {/* Line entries */}
        <FormSection
          title="Journal lines"
          description="Post each account on one side (Dr / Cr) in its own currency. Base = amount × rate. Fill one side, then press ⚖ on the other line to auto-fill its amount and balance the entry."
          icon={ListPlusIcon}
          contentClassName="p-0"
          actions={
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine("debit"))}>
                <PlusIcon /> Add debit
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine("credit"))}>
                <PlusIcon /> Add credit
              </Button>
            </div>
          }
        >
          {/* Cross-rate helper — set both currencies' rates from one number. */}
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">Cross rate:</span>
            <span className="text-sm">1</span>
            <Select value={crossA} onValueChange={setCrossA}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm">=</span>
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={crossVal}
              onChange={(e) => setCrossVal(e.target.value)}
              placeholder="77.5"
              className="w-28 text-right tabular-nums"
            />
            <Select value={crossB} onValueChange={setCrossB}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={applyCrossRate}>
              Apply rates
            </Button>
            <span className="text-xs text-muted-foreground">
              Sets {codeOf(crossA) || "A"} as reference (rate 1) and {codeOf(crossB) || "B"} = 1 ÷ rate.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                  <th className="w-10">Sno</th>
                  <th className="min-w-[160px]">Cost Center</th>
                  <th className="min-w-[240px]">Account</th>
                  <th className="w-28">Dr / Cr</th>
                  <th className="w-28">Currency</th>
                  <th className="w-32 text-right">Rate</th>
                  <th className="w-36 text-right">Amount</th>
                  <th className="w-36 text-right">Base</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((line, index) => {
                  const row = watchedLines?.[index];
                  const base = round2((Number(row?.amount) || 0) * (Number(row?.exchangeRate) || 0));
                  return (
                    <tr key={line.id} className="border-b align-top last:border-0 [&_td]:px-3 [&_td]:py-2">
                      <td className="pt-4 text-muted-foreground tabular-nums">{index + 1}</td>
                      <td>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.costCenterId`}
                          render={({ field }) => (
                            <FormItem>
                              <Select
                                value={field.value ? field.value : "none"}
                                onValueChange={(v) => field.onChange(v === "none" ? "" : v)}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="None" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="none">— None —</SelectItem>
                                  {costCenters.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.accountId`}
                          render={({ field }) => (
                            <FormItem>
                              <AccountCombobox
                                accounts={accounts}
                                value={field.value}
                                onValueChange={(v) => {
                                  field.onChange(v);
                                  applyLineAccountCurrency(index, v);
                                }}
                              />
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.side`}
                          render={({ field }) => (
                            <FormItem>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="debit">Debit</SelectItem>
                                  <SelectItem value="credit">Credit</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.currencyId`}
                          render={({ field }) => (
                            <FormItem>
                              <Select
                                value={field.value}
                                onValueChange={(v) => {
                                  field.onChange(v);
                                  form.setValue(`lines.${index}.exchangeRate`, rateById.get(v) ?? 1, {
                                    shouldValidate: true,
                                  });
                                }}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {currencies.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {c.code}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.exchangeRate`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.000001"
                                  min="0"
                                  className="text-right tabular-nums"
                                  {...field}
                                  value={field.value as number}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.amount`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="text-right tabular-nums"
                                  {...field}
                                  value={amountValue(field.value)}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td className="pt-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {base ? fmt(base) : "—"}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-primary"
                            onClick={() => autoBalance(index)}
                            title="Auto-fill this amount to balance the entry"
                            aria-label="Auto-balance this line"
                          >
                            <ScaleIcon className="size-4" />
                          </Button>
                        </div>
                      </td>
                      <td className="pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={fields.length <= 2}
                          onClick={() => remove(index)}
                          aria-label="Remove row"
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Balance bar — base-currency debit / credit totals + balanced flag. */}
          <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2 border-t bg-muted/30 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Base Debit <span className="ml-1 font-mono font-semibold tabular-nums text-foreground">{fmt(baseDebit)}</span>
            </span>
            <span className="text-sm text-muted-foreground">
              Base Credit{" "}
              <span className="ml-1 font-mono font-semibold tabular-nums text-foreground">{fmt(baseCredit)}</span>
            </span>
            <span
              className={cn(
                "rounded-md px-2.5 py-1 text-sm font-semibold",
                balanced
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {balanced ? "Balanced" : `Out by ${fmt(Math.abs(diff))}`}
            </span>
          </div>
        </FormSection>

        {formError && (
          <p className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            {formError}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" asChild>
            <Link href="/accounting/vouchers/multi_currency_journal">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isPending || !balanced}>
            {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create journal"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
