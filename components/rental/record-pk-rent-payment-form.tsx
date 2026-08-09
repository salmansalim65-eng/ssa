"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { AccountSelect, type AccountOption } from "@/components/vouchers/account-select";
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
import { recordPkRentPayment } from "@/features/rental/pk-rent-payments/actions";
import {
  recordPkPaymentSchema,
  type RecordPkPaymentFormValues,
  type RecordPkPaymentInput,
} from "@/features/rental/pk-rent-invoices/schemas";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function RecordPkRentPaymentForm({ invoiceId, accounts }: { invoiceId: string; accounts: AccountOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RecordPkPaymentFormValues, unknown, RecordPkPaymentInput>({
    resolver: zodResolver(recordPkPaymentSchema),
    defaultValues: { paymentDate: today(), amount: blankAmount, cashBankAccountId: "" },
  });

  function onSubmit(values: RecordPkPaymentInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await recordPkRentPayment(invoiceId, values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Payment recorded");
      form.reset({ paymentDate: today(), amount: blankAmount, cashBankAccountId: values.cashBankAccountId });
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-xl gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="cashBankAccountId"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Cash / bank account</FormLabel>
              <AccountSelect accounts={accounts} value={field.value} onValueChange={field.onChange} />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="paymentDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Payment date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Amount</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-2 sm:w-fit">
          {isPending ? "Recording…" : "Record payment"}
        </Button>
      </form>
    </Form>
  );
}
