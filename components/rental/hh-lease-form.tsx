"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { blankAmount, amountValue } from "@/lib/forms/amount";
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
import { CurrencySelect, type CurrencyOption } from "@/components/vouchers/currency-select";
import { createHhLease } from "@/features/rental/hh-leases/actions";
import { hhLeaseSchema, type HhLeaseFormValues, type HhLeaseInput } from "@/features/rental/hh-leases/schemas";

export interface AssetOption {
  id: string;
  asset_code: string;
  asset_name: string;
}

export interface TenantOption {
  id: string;
  name: string;
}

export interface ExpenseAccountOption {
  id: string;
  account_code: string;
  account_name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { assetId: "", rentalAmount: blankAmount, leaseStart: today(), leaseEnd: today(), expenses: [], remarks: "" };
}

// Per-property monthly expenses: an expense account (from the "Rental Expenses"
// CoA group) + amount. Each posts Dr <account> / Cr <tenant> when the HH invoice
// is generated, and feeds the Rent Balance report's Other Expenses column. Blank
// rows are dropped on save.
function LineExpenses({
  control,
  index,
  expenseAccounts,
}: {
  control: Control<HhLeaseFormValues>;
  index: number;
  expenseAccounts: ExpenseAccountOption[];
}) {
  const { fields, append, remove } = useFieldArray({ control, name: `lines.${index}.expenses` });
  return (
    <div className="space-y-1.5">
      {fields.map((f, ei) => (
        <div key={f.id} className="flex items-center gap-1.5">
          <FormField
            control={control}
            name={`lines.${index}.expenses.${ei}.accountId`}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={(field.value as string) ?? ""}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue placeholder="Expense account" />
                </SelectTrigger>
                <SelectContent>
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FormField
            control={control}
            name={`lines.${index}.expenses.${ei}.amount`}
            render={({ field }) => (
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                className="h-8 w-24"
                {...field}
                value={amountValue(field.value)}
              />
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => remove(ei)}
            aria-label="Remove expense"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7"
        disabled={expenseAccounts.length === 0}
        onClick={() => append({ accountId: "", amount: blankAmount })}
      >
        <PlusIcon className="size-3.5" /> Add expense
      </Button>
      {expenseAccounts.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add accounts under a &ldquo;Rental Expenses&rdquo; group in the Chart of Accounts first.
        </p>
      )}
    </div>
  );
}

export function HhLeaseForm({
  assets,
  tenants,
  currencies,
  defaultCurrencyId,
  expenseAccounts,
}: {
  assets: AssetOption[];
  tenants: TenantOption[];
  currencies: CurrencyOption[];
  defaultCurrencyId?: string;
  expenseAccounts: ExpenseAccountOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<HhLeaseFormValues, unknown, HhLeaseInput>({
    resolver: zodResolver(hhLeaseSchema),
    defaultValues: {
      tenantId: "",
      documentDate: today(),
      currencyId: defaultCurrencyId ?? currencies[0]?.id ?? "",
      rentCycle: "monthly",
      lines: [emptyLine()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  // Live column totals for the grid footer. Blank amount fields are "" so
  // `Number(x) || 0` keeps NaN out of the sums.
  const watchedLines = useWatch({ control: form.control, name: "lines" }) ?? [];
  const totalRent = watchedLines.reduce((sum, l) => sum + (Number(l?.rentalAmount) || 0), 0);
  const totalExpenses = watchedLines.reduce(
    (sum, l) => sum + (l?.expenses ?? []).reduce((es, e) => es + (Number(e?.amount) || 0), 0),
    0,
  );
  const fmtAmount = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function onSubmit(values: HhLeaseInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createHhLease(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success(`HH Lease ${result.documentNo} created (${result.count} lease line(s))`);
      if (result && "invoiceWarning" in result && result.invoiceWarning)
        toast.warning(result.invoiceWarning as string);
      router.push("/rental/uae/hh-lease");
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Voucher header */}
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormItem>
            <FormLabel>Document No.</FormLabel>
            <Input value="Auto" disabled readOnly />
          </FormItem>
          <FormField
            control={form.control}
            name="documentDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="tenantId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tenant</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select tenant" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {tenants.map((t) => (
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
          <FormField
            control={form.control}
            name="currencyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency</FormLabel>
                <CurrencySelect currencies={currencies} value={field.value} onValueChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="rentCycle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rent cycle</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select cycle" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Asset lines grid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Assets</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <PlusIcon className="size-4" /> Add row
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
                  <th className="w-10">Sno</th>
                  <th className="min-w-[200px]">Asset</th>
                  <th className="w-32">Rent</th>
                  <th className="w-40">Lease Start</th>
                  <th className="w-40">Lease End</th>
                  <th className="min-w-[260px]">Expenses</th>
                  <th className="min-w-[160px]">Remarks</th>
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
                        name={`lines.${index}.assetId`}
                        render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select asset" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {assets.map((a) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    {a.asset_name}
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
                        name={`lines.${index}.rentalAmount`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.leaseStart`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.leaseEnd`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <LineExpenses control={form.control} index={index} expenseAccounts={expenseAccounts} />
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
              <tfoot>
                <tr className="border-t bg-muted/50 font-semibold [&_td]:px-2 [&_td]:py-2">
                  <td />
                  <td className="text-right text-muted-foreground">Total</td>
                  <td className="tabular-nums">{fmtAmount(totalRent)}</td>
                  <td />
                  <td />
                  <td className="tabular-nums">{fmtAmount(totalExpenses)}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    <span className="text-muted-foreground">Grand&nbsp;total:</span> {fmtAmount(totalRent + totalExpenses)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:w-fit">
          {isPending ? "Saving…" : "Save HH Lease"}
        </Button>
      </form>
    </Form>
  );
}
