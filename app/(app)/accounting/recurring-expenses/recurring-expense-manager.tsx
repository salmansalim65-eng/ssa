"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { amountValue } from "@/lib/forms/amount";
import { formatDate, formatMoney } from "@/lib/format";
import {
  createRecurringExpense,
  deleteRecurringExpense,
  updateRecurringExpense,
} from "@/features/accounting/recurring-expenses/actions";
import {
  FREQUENCY_LABELS,
  RECURRING_FREQUENCIES,
  recurringExpenseSchema,
  type RecurringExpenseFormValues,
  type RecurringExpenseInput,
} from "@/features/accounting/recurring-expenses/schemas";

export interface RecurringExpenseRow {
  id: string;
  name: string;
  account_id: string | null;
  cost_center_id: string | null;
  currency_id: string;
  amount: number;
  frequency: (typeof RECURRING_FREQUENCIES)[number];
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  is_active: boolean;
}

interface Option {
  id: string;
  label: string;
}

const emptyValues: RecurringExpenseInput = {
  name: "",
  accountId: "",
  costCenterId: "",
  currencyId: "",
  amount: 0,
  frequency: "monthly",
  dayOfMonth: 1,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  notes: "",
  isActive: true,
};

export function RecurringExpenseManager({
  rows,
  accounts,
  costCentres,
  currencies,
  canCreate,
  canEdit,
  canDelete,
}: {
  rows: RecurringExpenseRow[];
  accounts: Option[];
  costCentres: Option[];
  currencies: Option[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; row: RecurringExpenseRow } | null>(null);
  const [isPending, startTransition] = useTransition();

  const nameOf = (list: Option[], id: string | null) => (id ? list.find((o) => o.id === id)?.label ?? "—" : "—");

  function remove(row: RecurringExpenseRow) {
    if (!confirm(`Remove “${row.name}” from the forecast?`)) return;
    startTransition(async () => {
      const result = await deleteRecurringExpense(row.id);
      if (result?.error) toast.error(result.error);
      else toast.success("Removed");
    });
  }

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Dialog
            open={dialog?.mode === "create"}
            onOpenChange={(open) => setDialog(open ? { mode: "create" } : null)}
          >
            <DialogTrigger asChild>
              <Button>
                <PlusIcon /> Add recurring expense
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add recurring expense</DialogTitle>
              </DialogHeader>
              <ExpenseForm
                accounts={accounts}
                costCentres={costCentres}
                currencies={currencies}
                defaultValues={emptyValues}
                submitLabel="Add"
                onSubmit={async (values) => {
                  const result = await createRecurringExpense(values);
                  if (!result?.error) {
                    toast.success("Recurring expense added");
                    setDialog(null);
                  }
                  return result;
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      )}

      <div className="rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={PlusIcon}
            title="No recurring expenses yet"
            description="Add the costs that fall due on a schedule — salaries, utilities, service charges, a tax instalment — and the Cash Flow Forecast will deduct them."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Cost centre</TableHead>
                <TableHead>How often</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={r.is_active ? undefined : "opacity-60"}>
                  <TableCell>
                    <span className="font-medium">{r.name}</span>
                    {!r.is_active && <span className="ml-2 text-xs text-muted-foreground">(paused)</span>}
                    {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{nameOf(accounts, r.account_id)}</TableCell>
                  <TableCell className="text-muted-foreground">{nameOf(costCentres, r.cost_center_id)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {FREQUENCY_LABELS[r.frequency]} · day {r.day_of_month}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(r.start_date)} – {r.end_date ? formatDate(r.end_date) : "ongoing"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {nameOf(currencies, r.currency_id)} {formatMoney(r.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit && (
                        <Dialog
                          open={dialog?.mode === "edit" && dialog.row.id === r.id}
                          onOpenChange={(open) => setDialog(open ? { mode: "edit", row: r } : null)}
                        >
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <PencilIcon className="size-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Edit recurring expense</DialogTitle>
                            </DialogHeader>
                            <ExpenseForm
                              accounts={accounts}
                              costCentres={costCentres}
                              currencies={currencies}
                              defaultValues={{
                                name: r.name,
                                accountId: r.account_id ?? "",
                                costCenterId: r.cost_center_id ?? "",
                                currencyId: r.currency_id,
                                amount: r.amount,
                                frequency: r.frequency,
                                dayOfMonth: r.day_of_month,
                                startDate: r.start_date,
                                endDate: r.end_date ?? "",
                                notes: r.notes ?? "",
                                isActive: r.is_active,
                              }}
                              submitLabel="Save changes"
                              onSubmit={async (values) => {
                                const result = await updateRecurringExpense(r.id, values);
                                if (!result?.error) {
                                  toast.success("Recurring expense updated");
                                  setDialog(null);
                                }
                                return result;
                              }}
                            />
                          </DialogContent>
                        </Dialog>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          disabled={isPending}
                          onClick={() => remove(r)}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function ExpenseForm({
  accounts,
  costCentres,
  currencies,
  defaultValues,
  submitLabel,
  onSubmit,
}: {
  accounts: Option[];
  costCentres: Option[];
  currencies: Option[];
  defaultValues: RecurringExpenseInput;
  submitLabel: string;
  onSubmit: (values: RecurringExpenseInput) => Promise<{ error?: string } | undefined>;
}) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RecurringExpenseFormValues, unknown, RecurringExpenseInput>({
    resolver: zodResolver(recurringExpenseSchema),
    defaultValues,
  });

  function handleSubmit(values: RecurringExpenseInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result?.error) setFormError(result.error);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. DEWA — 213 Shamal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="currencyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ""}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a currency" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
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
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount each time</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="frequency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>How often</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {RECURRING_FREQUENCIES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FREQUENCY_LABELS[f]}
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
            name="dayOfMonth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Day of the month it falls due</FormLabel>
                <FormControl>
                  <Input type="number" min={1} max={31} {...field} value={amountValue(field.value)} />
                </FormControl>
                <FormDescription>A month shorter than this day uses its last day.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First due</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last due (optional)</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormDescription>Leave blank while it runs on.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="accountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expense account (optional)</FormLabel>
                <Select
                  onValueChange={(v) => field.onChange(v === "none" ? "" : v)}
                  value={field.value || "none"}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
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
            name="costCenterId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cost centre (optional)</FormLabel>
                <Select
                  onValueChange={(v) => field.onChange(v === "none" ? "" : v)}
                  value={field.value || "none"}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {costCentres.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-2.5 rounded-lg border p-3">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Counted in the forecast</FormLabel>
                <FormDescription>Clear this to pause it without deleting it.</FormDescription>
              </div>
            </FormItem>
          )}
        />

        {formError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <div className="flex justify-end border-t pt-4">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
