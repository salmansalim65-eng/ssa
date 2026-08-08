"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  createOpeningBalanceVoucher,
  updateOpeningBalanceVoucher,
} from "@/features/accounting/vouchers/opening-balance/actions";
import {
  openingBalanceVoucherSchema,
  type OpeningBalanceVoucherFormValues,
  type OpeningBalanceVoucherInput,
} from "@/features/accounting/vouchers/opening-balance/schemas";

export interface CostCenterOption {
  id: string;
  name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { accountId: "", debit: 0, credit: 0, remarks: "" };
}

export function OpeningBalanceVoucherForm({
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
  initialValues?: OpeningBalanceVoucherFormValues;
}) {
  const router = useRouter();
  const isEdit = !!voucherId;
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<OpeningBalanceVoucherFormValues, unknown, OpeningBalanceVoucherInput>({
    resolver: zodResolver(openingBalanceVoucherSchema),
    defaultValues: initialValues ?? {
      asOfDate: today(),
      contraAccountId: "",
      costCenterId: "",
      currencyId: currencies[0]?.id ?? "",
      exchangeRate: currencies[0]?.rate ?? 1,
      narration: "",
      lines: [emptyLine()],
    },
  });

  const rateById = new Map(currencies.map((c) => [c.id, c.rate ?? 1] as const));

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const sumDebit = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.debit) || 0), 0);
  const sumCredit = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.credit) || 0), 0);
  const net = Math.round((sumDebit - sumCredit) * 100) / 100;

  function onSubmit(values: OpeningBalanceVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateOpeningBalanceVoucher(voucherId!, values)
        : await createOpeningBalanceVoucher(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success(isEdit ? "Opening balance voucher updated" : "Opening balance voucher created");
      router.push(`/accounting/vouchers/opening_balance_voucher/${isEdit ? voucherId : result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormSection
          title="Document information"
          description="Header details for this voucher."
          icon={FileTextIcon}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormItem>
            <FormLabel>Document No.</FormLabel>
            <Input value="Auto" disabled readOnly />
          </FormItem>
          <FormField
            control={form.control}
            name="asOfDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>As of date</FormLabel>
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
                  <Input type="number" step="0.0001" min="0" {...field} value={field.value as number} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contraAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contra account (Opening Balance Equity)</FormLabel>
                <AccountCombobox accounts={accounts} value={field.value} onValueChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="costCenterId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cost Center</FormLabel>
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
          <FormField
            control={form.control}
            name="narration"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
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

        <FormSection
          title="Opening balances"
          description="Opening debit and credit balances per account — any difference posts to the contra account."
          icon={ListPlusIcon}
          contentClassName="p-0"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <PlusIcon /> Add row
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                  <th className="w-10">Sno</th>
                  <th className="min-w-[240px]">Account</th>
                  <th className="w-36 text-right">Debit</th>
                  <th className="w-36 text-right">Credit</th>
                  <th className="min-w-[150px]">Remarks</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((line, index) => (
                  <tr key={line.id} className="border-b align-top last:border-0 [&_td]:px-3 [&_td]:py-2">
                    <td className="pt-4 text-muted-foreground">{index + 1}</td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.accountId`}
                        render={({ field }) => (
                          <FormItem>
                            <AccountCombobox accounts={accounts} value={field.value} onValueChange={field.onChange} />
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.debit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" className="text-right tabular-nums" {...field} value={field.value as number} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.credit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" className="text-right tabular-nums" {...field} value={field.value as number} />
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
          <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2 border-t bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-muted-foreground">Total Debit</span>
              <span className="text-base font-semibold tabular-nums text-foreground">{sumDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-muted-foreground">Total Credit</span>
              <span className="text-base font-semibold tabular-nums text-foreground">{sumCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            {net === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-success/12 px-2.5 py-1 text-xs font-semibold text-success">
                <span className="size-1.5 rounded-full bg-success" aria-hidden />
                Balanced
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                contra {net > 0 ? "Cr" : "Dr"} {Math.abs(net).toLocaleString()}
              </span>
            )}
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
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create opening balance voucher"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
