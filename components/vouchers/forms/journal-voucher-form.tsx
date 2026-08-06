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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountSelect, type AccountOption } from "@/components/vouchers/account-select";
import { CurrencySelect, type CurrencyOption } from "@/components/vouchers/currency-select";
import { createJournalVoucher, updateJournalVoucher } from "@/features/accounting/vouchers/journal/actions";
import {
  journalVoucherSchema,
  type JournalVoucherFormValues,
  type JournalVoucherInput,
} from "@/features/accounting/vouchers/journal/schemas";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function JournalVoucherForm({
  accounts,
  currencies,
  voucherId,
  initialValues,
}: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
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
      narration: "",
      lines: [
        { accountId: "", debit: 0, credit: 0, description: "" },
        { accountId: "", debit: 0, credit: 0, description: "" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const totalDebit = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.debit) || 0), 0);
  const totalCredit = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  function onSubmit(values: JournalVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateJournalVoucher(voucherId!, values)
        : await createJournalVoucher(values);
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-3xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="entryDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Entry date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
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
                <CurrencySelect currencies={currencies} value={field.value} onValueChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="narration"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Narration</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="w-32">Debit</TableHead>
              <TableHead className="w-32">Credit</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((line, index) => (
              <TableRow key={line.id}>
                <TableCell>
                  <FormField
                    control={form.control}
                    name={`lines.${index}.accountId`}
                    render={({ field }) => (
                      <FormItem>
                        <AccountSelect accounts={accounts} value={field.value} onValueChange={field.onChange} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={form.control}
                    name={`lines.${index}.debit`}
                    render={({ field }) => (
                      <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={form.control}
                    name={`lines.${index}.credit`}
                    render={({ field }) => (
                      <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={form.control}
                    name={`lines.${index}.description`}
                    render={({ field }) => <Input {...field} />}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={fields.length <= 2}
                    onClick={() => remove(index)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ accountId: "", debit: 0, credit: 0, description: "" })}
          >
            <PlusIcon /> Add line
          </Button>
          <p className={`text-sm font-medium ${balanced ? "text-success" : "text-destructive"}`}>
            Debit {totalDebit.toLocaleString()} — Credit {totalCredit.toLocaleString()}
            {!balanced && " (not balanced)"}
          </p>
        </div>

        {form.formState.errors.lines?.root?.message && (
          <p className="text-sm text-destructive">{form.formState.errors.lines.root.message}</p>
        )}
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <Button type="submit" disabled={isPending}>
          {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create journal voucher"}
        </Button>
      </form>
    </Form>
  );
}
