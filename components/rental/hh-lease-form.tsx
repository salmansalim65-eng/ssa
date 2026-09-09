"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CopyIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { blankAmount, amountValue } from "@/lib/forms/amount";
import { MONTH_NAMES } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { MonthInput } from "@/components/vouchers/month-input";
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

/**
 * What a property was last let on, as the grid needs it. Structural on purpose:
 * the loader that builds it (lib/rental/last-contracts) is server-only, and this
 * is a client component.
 */
export interface RenewSource {
  documentNo: string | null;
  tenantAccountId: string | null;
  tenantName: string | null;
  start: string;
  end: string;
  rentalAmount: number;
  rentCycle: "monthly" | "yearly";
  paymentTerms: "advance" | "monthly" | "quarterly" | "half_yearly" | "yearly";
  expenses: { accountId: string; amount: number }[];
  nextStart: string;
  nextEnd: string;
}

export interface ExpenseAccountOption {
  id: string;
  account_code: string;
  account_name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** The first of the month a date falls in, as the ISO date months are stored as. */
function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of that month. */
function monthEnd(month: string) {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${month.slice(0, 7)}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** "September 2026", for saying which month is being invoiced. */
function monthName(month: string) {
  const m = Number(month.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTH_NAMES[m - 1]} ${month.slice(0, 4)}` : "";
}

/** True when a line covers a whole calendar month exactly, start to end. */
function spansWholeMonth(start?: string, end?: string) {
  if (!start || !end) return false;
  return start === monthStart(start) && end === monthEnd(start) && start.slice(0, 7) === end.slice(0, 7);
}

function emptyLine(month?: string) {
  return {
    assetId: "",
    rentalAmount: blankAmount,
    leaseStart: month ? monthStart(month) : today(),
    leaseEnd: month ? monthEnd(month) : today(),
    expenses: [],
    remarks: "",
    paymentTerms: "monthly" as const,
    vacant: false,
  };
}

const PAYMENT_TERMS_OPTIONS = [
  { value: "advance", label: "Advance" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half yearly" },
  { value: "yearly", label: "Yearly" },
] as const;

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
  createAction = createHhLease,
  docLabel = "HH Rent Invoice",
  redirectHref = "/rental/uae/hh-lease",
  managementPct = 0.1,
  initialValues,
  submitLabel,
  monthly = false,
  lastInvoice,
  invoicedMonths = [],
  renewFrom,
}: {
  assets: AssetOption[];
  tenants: TenantOption[];
  currencies: CurrencyOption[];
  defaultCurrencyId?: string;
  expenseAccounts: ExpenseAccountOption[];
  // The server action that creates the voucher. Defaults to HH; UAE passes its
  // own so this one grid drives both HH and UAE Rent Invoices.
  createAction?: (values: HhLeaseInput) => Promise<{
    error?: string;
    documentNo?: string;
    count?: number;
    invoiceWarning?: string;
  }>;
  docLabel?: string;
  redirectHref?: string;
  // Management (agent) charge as a fraction of rent — HH 10%, UAE 5%. Shown as a
  // column and deducted from the grand total.
  managementPct?: number;
  // When editing an existing voucher, its current values pre-fill the grid.
  initialValues?: HhLeaseFormValues;
  submitLabel?: string;
  // HH is invoiced once a month for every property at once. That turns on the
  // month field, the "copy last month" fill and the per-property Vacant mark.
  // The yearly UAE grid leaves it off and behaves exactly as before.
  monthly?: boolean;
  /** The previous month's invoice, offered as the starting point for this one. */
  lastInvoice?: { documentNo: string; rentMonth: string | null; lines: HhLeaseFormValues["lines"] };
  /** Months already invoiced (ISO first-of-month), so a repeat is caught early. */
  invoicedMonths?: string[];
  /**
   * What each property was last let on, keyed by asset id. A renewal is the same
   * contract one period later, so picking a property offers its terms back
   * rather than making them be re-keyed off the old paper.
   */
  renewFrom?: Record<string, RenewSource>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<HhLeaseFormValues, unknown, HhLeaseInput>({
    resolver: zodResolver(hhLeaseSchema),
    defaultValues: initialValues ?? {
      tenantId: "",
      documentDate: today(),
      rentMonth: monthly ? monthStart(today()) : "",
      currencyId: defaultCurrencyId ?? currencies[0]?.id ?? "",
      rentCycle: "monthly",
      lines: [emptyLine(monthly ? monthStart(today()) : undefined)],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "lines" });

  const rentMonth = (useWatch({ control: form.control, name: "rentMonth" }) as string | undefined) ?? "";
  // An invoice already exists for this month. Not blocked — a correction or a
  // second batch is legitimate — but said plainly before it is saved twice.
  const alreadyInvoiced = monthly && rentMonth !== "" && invoicedMonths.includes(rentMonth);

  /**
   * Moving the invoice to another month re-dates the lines that cover a WHOLE
   * month, which is what a routine monthly line looks like. A line carrying real
   * stay dates (an HH let that ran 3–19 August) is left exactly as entered —
   * those are facts about the stay, not a default to be overwritten.
   */
  function applyMonth(month: string) {
    form.setValue("rentMonth", month, { shouldDirty: true });
    if (!month) return;
    const lines = form.getValues("lines") ?? [];
    lines.forEach((line, i) => {
      if (!spansWholeMonth(line?.leaseStart, line?.leaseEnd)) return;
      form.setValue(`lines.${i}.leaseStart`, monthStart(month), { shouldDirty: true });
      form.setValue(`lines.${i}.leaseEnd`, monthEnd(month), { shouldDirty: true });
    });
  }

  /**
   * Start this month from the last invoice: the same properties, rents, terms
   * and expenses, re-dated to the month being billed. Nothing is posted by this
   * — it only fills the grid, and every line is still editable (or markable
   * vacant) before it is saved.
   */
  function copyLastInvoice() {
    if (!lastInvoice) return;
    const month = rentMonth || monthStart(today());
    replace(
      lastInvoice.lines.map((line) => ({
        ...line,
        // Carry a line's own stay dates across only as far as the month; a
        // routine full-month line lands on the new month, a short stay keeps its
        // shape but is the user's to correct.
        leaseStart: monthStart(month),
        leaseEnd: monthEnd(month),
        vacant: false,
      })),
    );
  }

  /**
   * Put a property's last contract into its line: the same rent, terms and
   * expenses, dated for the period that follows the old one.
   *
   * `onlyBlanks` is the difference between picking a property and asking for a
   * renewal. Picking a property fills what is still empty and leaves anything
   * already typed alone; pressing Renew is an explicit instruction, so it
   * replaces the line's terms outright.
   */
  function applyRenewal(index: number, assetId: string, onlyBlanks: boolean) {
    const source = renewFrom?.[assetId];
    if (!source) return;
    const line = form.getValues(`lines.${index}`);
    const setLine = (name: "rentalAmount" | "leaseStart" | "leaseEnd" | "paymentTerms" | "expenses", value: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.setValue(`lines.${index}.${name}` as any, value as any, { shouldDirty: true });

    if (!onlyBlanks || !(Number(line?.rentalAmount) > 0)) setLine("rentalAmount", source.rentalAmount);
    if (!onlyBlanks || (line?.expenses ?? []).length === 0) setLine("expenses", source.expenses);
    if (!onlyBlanks || (line?.paymentTerms ?? "monthly") === "monthly") setLine("paymentTerms", source.paymentTerms);
    // The renewal period is the whole point of the offer, so it is always set.
    setLine("leaseStart", source.nextStart);
    setLine("leaseEnd", source.nextEnd);

    // The header follows the contract too, but only while it is untouched — one
    // voucher carries a single tenant, and the first property picked should not
    // overrule a tenant the user has already chosen.
    if (source.tenantAccountId && !form.getValues("tenantId")) {
      form.setValue("tenantId", source.tenantAccountId, { shouldDirty: true });
    }
    if (!onlyBlanks) form.setValue("rentCycle", source.rentCycle, { shouldDirty: true });
  }

  // Live column totals for the grid footer. Blank amount fields are "" so
  // `Number(x) || 0` keeps NaN out of the sums.
  const watchedLines = useWatch({ control: form.control, name: "lines" }) ?? [];
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const rowManagement = (rent: unknown) => round2((Number(rent) || 0) * managementPct);
  const totalRent = watchedLines.reduce((sum, l) => sum + (Number(l?.rentalAmount) || 0), 0);
  const totalManagement = watchedLines.reduce((sum, l) => sum + rowManagement(l?.rentalAmount), 0);
  const totalExpenses = watchedLines.reduce(
    (sum, l) => sum + (l?.expenses ?? []).reduce((es, e) => es + (Number(e?.amount) || 0), 0),
    0,
  );
  // Owner's net: rent LESS management (agent) charge LESS other expenses.
  const grandTotal = round2(totalRent - totalManagement - totalExpenses);
  const fmtAmount = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function onSubmit(values: HhLeaseInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createAction(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success(`${docLabel} ${result.documentNo} saved (${result.count} propertie(s))`);
      if (result && "invoiceWarning" in result && result.invoiceWarning)
        toast.warning(result.invoiceWarning as string);
      router.push(redirectHref);
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
          {monthly && (
            <FormField
              control={form.control}
              name="rentMonth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rent month</FormLabel>
                  <FormControl>
                    <MonthInput value={(field.value as string) ?? ""} onChange={applyMonth} />
                  </FormControl>
                  {alreadyInvoiced && (
                    <p className="text-xs font-medium text-destructive">
                      {monthName(rentMonth)} has already been invoiced — check before saving another.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">
              Assets
              {monthly && rentMonth && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">for {monthName(rentMonth)}</span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {monthly && lastInvoice && (
                <Button type="button" variant="outline" size="sm" onClick={copyLastInvoice}>
                  <CopyIcon className="size-4" /> Copy {lastInvoice.documentNo}
                  {lastInvoice.rentMonth ? ` (${monthName(lastInvoice.rentMonth)})` : ""}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append(emptyLine(monthly ? rentMonth || undefined : undefined))}
              >
                <PlusIcon className="size-4" /> Add row
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
                  <th className="w-10">Sno</th>
                  <th className="min-w-[200px]">Asset</th>
                  {monthly && <th className="w-20">Vacant</th>}
                  <th className="w-32">Rent/Month</th>
                  <th className="w-28">Management</th>
                  <th className="w-40">Lease Start</th>
                  <th className="w-40">Lease End</th>
                  <th className="w-36">Payment Terms</th>
                  <th className="min-w-[260px]">Expenses</th>
                  <th className="w-28 text-right">Total</th>
                  <th className="min-w-[160px]">Remarks</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((line, index) => {
                  // A vacant property is on the invoice to be COUNTED: it keeps
                  // its dates so the empty period is on the record, but charges
                  // nothing, so rent, management and expenses are switched off.
                  const isVacant = watchedLines[index]?.vacant === true;
                  return (
                  <tr key={line.id} className={cn("border-b align-top [&_td]:px-2 [&_td]:py-2", isVacant && "bg-muted/40")}>
                    <td className="pt-4 text-muted-foreground">{index + 1}</td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.assetId`}
                        render={({ field }) => {
                          const source = renewFrom?.[field.value as string];
                          return (
                          <FormItem>
                            <Select
                              onValueChange={(assetId) => {
                                field.onChange(assetId);
                                applyRenewal(index, assetId, true);
                              }}
                              value={field.value}
                            >
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
                            {/* Where the terms on this line can come from, and
                                what pressing Renew would set them to. */}
                            {source && (
                              <button
                                type="button"
                                onClick={() => applyRenewal(index, field.value as string, false)}
                                className="text-left text-xs text-primary hover:underline"
                              >
                                <RefreshCwIcon className="mr-1 inline size-3" />
                                Renew{source.documentNo ? ` ${source.documentNo}` : ""} — last term to{" "}
                                {source.end}, renews to {source.nextEnd}
                              </button>
                            )}
                            <FormMessage />
                          </FormItem>
                          );
                        }}
                      />
                    </td>
                    {monthly && (
                      <td className="pt-4">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.vacant`}
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2">
                              <FormControl>
                                <Checkbox
                                  checked={field.value === true}
                                  onCheckedChange={(checked) => {
                                    const vacant = checked === true;
                                    field.onChange(vacant);
                                    // Marking a property vacant clears what it
                                    // would have charged, so nothing is billed by
                                    // a figure left behind from before.
                                    if (vacant) {
                                      form.setValue(`lines.${index}.rentalAmount`, blankAmount, { shouldDirty: true });
                                      form.setValue(`lines.${index}.expenses`, [], { shouldDirty: true });
                                    }
                                  }}
                                  aria-label="Property was vacant this period"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </td>
                    )}
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.rentalAmount`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                disabled={isVacant}
                                {...field}
                                value={isVacant ? "" : amountValue(field.value)}
                                placeholder={isVacant ? "Vacant" : undefined}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="pt-3 text-right font-mono tabular-nums text-muted-foreground">
                      {fmtAmount(rowManagement(watchedLines[index]?.rentalAmount))}
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
                      <FormField
                        control={form.control}
                        name={`lines.${index}.paymentTerms`}
                        render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={field.onChange} value={(field.value as string) ?? "monthly"}>
                              <FormControl>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Terms" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {PAYMENT_TERMS_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
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
                      {isVacant ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <LineExpenses control={form.control} index={index} expenseAccounts={expenseAccounts} />
                      )}
                    </td>
                    <td className="pt-3 text-right font-mono font-medium tabular-nums">
                      {fmtAmount(
                        round2(
                          (Number(watchedLines[index]?.rentalAmount) || 0) -
                            rowManagement(watchedLines[index]?.rentalAmount) -
                            (watchedLines[index]?.expenses ?? []).reduce(
                              (es, e) => es + (Number(e?.amount) || 0),
                              0,
                            ),
                        ),
                      )}
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
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-semibold [&_td]:px-2 [&_td]:py-2">
                  <td />
                  <td className="text-right text-muted-foreground">Total</td>
                  {monthly && (
                    <td className="text-xs font-normal text-muted-foreground">
                      {watchedLines.filter((l) => l?.vacant).length} vacant
                    </td>
                  )}
                  <td className="tabular-nums">{fmtAmount(totalRent)}</td>
                  <td className="text-right tabular-nums">{fmtAmount(totalManagement)}</td>
                  <td />
                  <td />
                  <td />
                  <td className="tabular-nums">{fmtAmount(totalExpenses)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    <span className="text-muted-foreground">Grand&nbsp;total:</span> {fmtAmount(grandTotal)}
                  </td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:w-fit">
          {isPending ? "Saving…" : (submitLabel ?? `Save ${docLabel}`)}
        </Button>
      </form>
    </Form>
  );
}
