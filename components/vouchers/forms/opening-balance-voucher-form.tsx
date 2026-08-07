"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3">
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Opening balances</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <PlusIcon className="size-4" /> Add row
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
                  <th className="w-10">Sno</th>
                  <th className="min-w-[240px]">Account</th>
                  <th className="w-36">Debit</th>
                  <th className="w-36">Credit</th>
                  <th className="min-w-[150px]">Remarks</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((line, index) => (
                  <tr key={line.id} className="border-b align-top [&_td]:px-2 [&_td]:py-2">
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
                              <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
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
                              <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
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

          <p className="text-right text-sm font-medium">
            Debit {sumDebit.toLocaleString()} — Credit {sumCredit.toLocaleString()}
            {net !== 0 && (
              <span className="text-muted-foreground">
                {" "}
                · contra {net > 0 ? "Cr" : "Dr"} {Math.abs(net).toLocaleString()}
              </span>
            )}
          </p>
        </div>

        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:w-fit">
          {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create opening balance voucher"}
        </Button>
      </form>
    </Form>
  );
}
