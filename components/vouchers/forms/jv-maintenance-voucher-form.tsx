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
import {
  createJvMaintenanceVoucher,
  updateJvMaintenanceVoucher,
} from "@/features/accounting/vouchers/jv-maintenance/actions";
import {
  jvMaintenanceVoucherSchema,
  type JvMaintenanceVoucherFormValues,
  type JvMaintenanceVoucherInput,
} from "@/features/accounting/vouchers/jv-maintenance/schemas";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export interface JournalVoucherOption {
  id: string;
  voucherNo: string | null;
}

export function JvMaintenanceVoucherForm({
  accounts,
  currencies,
  journalVouchers,
  voucherId,
  initialValues,
}: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
  journalVouchers: JournalVoucherOption[];
  voucherId?: string;
  initialValues?: JvMaintenanceVoucherFormValues;
}) {
  const router = useRouter();
  const isEdit = !!voucherId;
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<JvMaintenanceVoucherFormValues, unknown, JvMaintenanceVoucherInput>({
    resolver: zodResolver(jvMaintenanceVoucherSchema),
    defaultValues: initialValues ?? {
      entryDate: today(),
      currencyId: currencies[0]?.id ?? "",
      originalJvId: "",
      adjustmentReason: "",
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

  function onSubmit(values: JvMaintenanceVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateJvMaintenanceVoucher(voucherId!, values)
        : await createJvMaintenanceVoucher(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success(isEdit ? "JV maintenance voucher updated" : "JV maintenance voucher created");
      router.push(`/accounting/vouchers/jv_maintenance_voucher/${isEdit ? voucherId : result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-3xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="originalJvId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Original journal voucher</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select the JV being corrected" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {journalVouchers.map((jv) => (
                      <SelectItem key={jv.id} value={jv.id}>
                        {jv.voucherNo ?? jv.id}
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
            name="adjustmentReason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Adjustment reason</FormLabel>
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

        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <Button type="submit" disabled={isPending}>
          {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create JV maintenance voucher"}
        </Button>
      </form>
    </Form>
  );
}
