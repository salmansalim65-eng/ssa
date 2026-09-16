"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, FileTextIcon, ListPlusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountCombobox, type AccountOption } from "@/components/vouchers/account-combobox";
import { CurrencySelect, type CurrencyOption } from "@/components/vouchers/currency-select";
import { DateInput } from "@/components/vouchers/date-input";
import {
  accountsForCurrency,
  buildAccountCostCentre,
  buildAccountCurrency,
} from "@/lib/vouchers/account-currency";
import { blankAmount, amountValue } from "@/lib/forms/amount";
import { createExpenseVoucher, updateExpenseVoucher } from "@/features/accounting/vouchers/expense/actions";
import {
  expenseVoucherSchema,
  type ExpenseVoucherFormValues,
  type ExpenseVoucherInput,
} from "@/features/accounting/vouchers/expense/schemas";

export interface TagOption {
  id: string;
  name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { accountId: "", costCenterId: "", tagId: "", amount: blankAmount, remarks: "" };
}

/**
 * The Expense Voucher: a run of costs paid out of one cash or bank account.
 *
 * The cost centre and the tag sit on each LINE, not on the header. One trip to
 * the bank pays for several things at once — a plumber for one property, fuel
 * for another — and a single header cost centre would lose which was which.
 */
export function ExpenseVoucherForm({
  accounts,
  currencies,
  tags,
  defaultCreditAccountId,
  expenseAccountIds,
  voucherId,
  initialValues,
}: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
  tags: TagOption[];
  /** The float bank account, pre-selected on a new voucher. */
  defaultCreditAccountId?: string | null;
  /**
   * The only accounts an expense line may be posted to. Undefined leaves the
   * picker open — the restriction is a property of this company's chart, not of
   * the form, so a chart without the group simply doesn't narrow anything.
   */
  expenseAccountIds?: string[];
  voucherId?: string;
  initialValues?: ExpenseVoucherFormValues;
}) {
  const router = useRouter();
  const isEdit = !!voucherId;
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const rateById = new Map(currencies.map((c) => [c.id, c.rate ?? 1] as const));

  // An account carries its own currency, so the first one picked sets the
  // voucher's: choose MEEZAAN BANK and the voucher becomes PKR. From then on
  // every picker offers only that currency's accounts (plus the currency-less
  // ones), so a voucher can't mix a PKR bank with an AED expense.
  const currencyOf = useMemo(() => buildAccountCurrency(accounts, currencies), [accounts, currencies]);
  const costCentreOf = useMemo(() => buildAccountCostCentre(accounts), [accounts]);

  // A pre-selected bank brings its currency with it, or the form would open in
  // the base currency and show a conversion row for money that needs none.
  const defaultCurrencyId =
    (defaultCreditAccountId && currencyOf(defaultCreditAccountId)) || currencies[0]?.id || "";

  const form = useForm<ExpenseVoucherFormValues, unknown, ExpenseVoucherInput>({
    resolver: zodResolver(expenseVoucherSchema),
    defaultValues: initialValues ?? {
      expenseDate: today(),
      creditAccountId: defaultCreditAccountId ?? "",
      paidTo: "",
      currencyId: defaultCurrencyId,
      exchangeRate: rateById.get(defaultCurrencyId) ?? 1,
      narration: "",
      lines: [emptyLine()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const currencyId = useWatch({ control: form.control, name: "currencyId" });
  const total = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.amount) || 0), 0);
  const currencyCode = currencies.find((c) => c.id === currencyId)?.code ?? "";
  // The company's base currency comes first, so a voucher in it is the ordinary
  // case and needs no currency row at all — the cash/bank account decides. Only
  // a foreign-currency account reveals the currency and its conversion rate.
  const isBaseCurrency = !currencyId || currencyId === currencies[0]?.id;
  const headerAccountId = useWatch({ control: form.control, name: "creditAccountId" });

  function applyAccountCurrency(accountId: string) {
    const cur = currencyOf(accountId);
    if (!cur || !rateById.has(cur)) return;
    form.setValue("currencyId", cur, { shouldValidate: true });
    form.setValue("exchangeRate", rateById.get(cur) ?? 1, { shouldValidate: true });
  }
  /**
   * The grid has no cost-centre column: an expense account carries its own
   * default, and picking the account fills the line's silently, so cost-centre
   * reports still work without anyone choosing one. The cash/bank side never
   * drives it — the same bank serves every cost centre.
   */
  function applyLineCostCentre(index: number, accountId: string) {
    const cc = costCentreOf(accountId);
    if (!cc || form.getValues(`lines.${index}.costCenterId`)) return;
    form.setValue(`lines.${index}.costCenterId`, cc, { shouldValidate: true });
  }
  const anchored =
    !!currencyOf(headerAccountId) || (watchedLines ?? []).some((l) => !!currencyOf(l?.accountId));
  /** The accounts a picker may offer; `value` is its own, never filtered away. */
  const accountsFor = (value?: string) =>
    anchored ? accountsForCurrency(accounts, currencyId, currencyOf, value) : accounts;
  /**
   * An expense line may only be posted under the KHI EXPENSE group. A line
   * already holding some other account keeps it visible, so opening an older
   * voucher never blanks a field the picker no longer offers.
   */
  const expenseAllowed = expenseAccountIds?.length ? new Set(expenseAccountIds) : null;
  const expenseAccountsFor = (value?: string) => {
    const offered = accountsFor(value);
    if (!expenseAllowed) return offered;
    return offered.filter((a) => expenseAllowed.has(a.id) || a.id === value);
  };

  function onSubmit(values: ExpenseVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateExpenseVoucher(voucherId!, values)
        : await createExpenseVoucher(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      // Saved but unposted is not a failure — the voucher exists and the reason
      // it did not post is the one thing worth reading, so it is said out loud
      // rather than left to be noticed as a "Draft" badge later.
      if (result?.warning) toast.warning(result.warning);
      else toast.success(isEdit ? "Expense voucher updated" : "Expense voucher created");
      router.push(`/accounting/vouchers/expense_voucher/${result.id ?? voucherId}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormSection
          title="Document information"
          description="Header details for this expense voucher."
          icon={FileTextIcon}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormItem>
              <FormLabel>Document No.</FormLabel>
              <Input value="Auto" disabled readOnly />
            </FormItem>
            <FormField
              control={form.control}
              name="expenseDate"
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
              name="creditAccountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Paid from (Cash/Bank)</FormLabel>
                  <AccountCombobox
                    accounts={accountsFor(field.value)}
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      applyAccountCurrency(v);
                    }}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paidTo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Paid to</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!isBaseCurrency && (
              <>
                <FormField
                  control={form.control}
                  name="currencyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <CurrencySelect
                        currencies={currencies}
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                          form.setValue("exchangeRate", rateById.get(v) ?? 1, { shouldValidate: true });
                        }}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="exchangeRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency Conv.</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.000001" min="0" {...field} value={field.value as number} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
          </div>
        </FormSection>

        <FormSection
          title="Expenses"
          description="What was spent, under which tag."
          icon={ListPlusIcon}
          contentClassName="p-0"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <PlusIcon /> Add expense
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                  <th className="w-10">Sno</th>
                  <th className="min-w-[220px]">Expense account (Dr)</th>
                  <th className="min-w-[140px]">Tag</th>
                  <th className="w-36 text-right">Amount</th>
                  <th className="min-w-[150px]">Remarks</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((line, index) => (
                  <tr key={line.id} className="border-b align-top last:border-0 [&_td]:px-3 [&_td]:py-2">
                    <td className="pt-4 text-muted-foreground tabular-nums">{index + 1}</td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.accountId`}
                        render={({ field }) => (
                          <FormItem>
                            <AccountCombobox
                              accounts={expenseAccountsFor(field.value)}
                              value={field.value}
                              onValueChange={(v) => {
                                field.onChange(v);
                                applyAccountCurrency(v);
                                applyLineCostCentre(index, v);
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
                        name={`lines.${index}.tagId`}
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
                                {tags.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name}
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
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.remarks`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={fields.length === 1}
                        onClick={() => remove(index)}
                        aria-label="Remove row"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-6 border-t bg-muted/30 px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">Total Expense</span>
            <span className="text-xl font-semibold tabular-nums text-foreground">
              {currencyCode && <span className="mr-1 text-sm font-medium text-muted-foreground">{currencyCode}</span>}
              {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        </FormSection>

        {formError && (
          <p className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            {formError}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" asChild>
            <Link href="/accounting/vouchers/expense_voucher">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create expense voucher"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
