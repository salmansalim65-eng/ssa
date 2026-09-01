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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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
import { accountsForCurrency, buildAccountCurrency } from "@/lib/vouchers/account-currency";
import { blankAmount, amountValue } from "@/lib/forms/amount";
import { createJournalVoucher, updateJournalVoucher } from "@/features/accounting/vouchers/journal/actions";
import {
  journalVoucherSchema,
  type JournalVoucherFormValues,
  type JournalVoucherInput,
} from "@/features/accounting/vouchers/journal/schemas";

export interface CostCenterOption {
  id: string;
  name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { costCenterId: "", debitAccountId: "", creditAccountId: "", amount: blankAmount };
}

export function JournalVoucherForm({
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
  initialValues?: JournalVoucherFormValues;
}) {
  const router = useRouter();
  const isEdit = !!voucherId;
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<JournalVoucherFormValues, unknown, JournalVoucherInput>({
    resolver: zodResolver(journalVoucherSchema),
    defaultValues: initialValues ?? {
      entryDate: today(),
      currencyId: currencies[0]?.id ?? "",
      exchangeRate: currencies[0]?.rate ?? 1,
      narration: "",
      lines: [emptyLine()],
    },
  });

  const rateById = new Map(currencies.map((c) => [c.id, c.rate ?? 1] as const));

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const currencyId = useWatch({ control: form.control, name: "currencyId" });
  const total = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.amount) || 0), 0);
  const currencyCode = currencies.find((c) => c.id === currencyId)?.code ?? "";

  // An account carries its own currency, so the first one picked sets the
  // voucher's: choose MEEZAN BANK and the voucher becomes PKR. From then on the
  // voucher is anchored and every account picker offers only that currency's
  // accounts (plus the currency-less ones, e.g. CAPITAL), so a voucher can't mix
  // a PKR account with an AED one.
  const currencyOf = useMemo(() => buildAccountCurrency(accounts, currencies), [accounts, currencies]);
  function applyAccountCurrency(accountId: string) {
    const cur = currencyOf(accountId);
    if (!cur || !rateById.has(cur)) return;
    form.setValue("currencyId", cur, { shouldValidate: true });
    form.setValue("exchangeRate", rateById.get(cur) ?? 1, { shouldValidate: true });
  }
  const anchored = (watchedLines ?? []).some(
    (l) => !!currencyOf(l?.debitAccountId) || !!currencyOf(l?.creditAccountId),
  );
  /** The accounts a picker may offer; `value` is its own, never filtered away. */
  const accountsFor = (value?: string) =>
    anchored ? accountsForCurrency(accounts, currencyId, currencyOf, value) : accounts;

  function onSubmit(values: JournalVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit ? await updateJournalVoucher(voucherId!, values) : await createJournalVoucher(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success(isEdit ? "Journal voucher updated" : "Journal voucher created");
      router.push(`/accounting/vouchers/journal_voucher/${isEdit ? voucherId : result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Document header */}
        <FormSection title="Document information" description="Header details for this journal voucher." icon={FileTextIcon}>
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
            <FormField
              control={form.control}
              name="narration"
              render={({ field }) => (
                <FormItem className="sm:col-span-2 lg:col-span-3">
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
          title="Journal entries"
          description="Each row posts a balanced debit / credit pair for the given amount."
          icon={ListPlusIcon}
          contentClassName="p-0"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <PlusIcon /> Add entry
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                  <th className="w-10">Sno</th>
                  <th className="min-w-[180px]">Cost Center</th>
                  <th className="min-w-[240px]">Debit Account</th>
                  <th className="min-w-[240px]">Credit Account</th>
                  <th className="w-40 text-right">Amount</th>
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
                        name={`lines.${index}.debitAccountId`}
                        render={({ field }) => (
                          <FormItem>
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
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.creditAccountId`}
                        render={({ field }) => (
                          <FormItem>
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

          {/* Strong totals bar */}
          <div className="flex items-center justify-end gap-6 border-t bg-muted/30 px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">Total Amount</span>
            <span className="text-xl font-semibold tabular-nums text-foreground">
              {currencyCode && <span className="mr-1 text-sm font-medium text-muted-foreground">{currencyCode}</span>}
              {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
            <Link href="/accounting/vouchers/journal_voucher">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create journal voucher"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
