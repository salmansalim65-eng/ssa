"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { AccountSelect, type AccountOption } from "@/components/vouchers/account-select";
import { CurrencySelect, type CurrencyOption } from "@/components/vouchers/currency-select";
import { createPdcPaymentVoucher } from "@/features/accounting/vouchers/pdc-payment/actions";
import {
  pdcPaymentVoucherSchema,
  type PdcPaymentVoucherFormValues,
  type PdcPaymentVoucherInput,
} from "@/features/accounting/vouchers/pdc-payment/schemas";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function PdcPaymentVoucherForm({
  accounts,
  currencies,
}: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<PdcPaymentVoucherFormValues, unknown, PdcPaymentVoucherInput>({
    resolver: zodResolver(pdcPaymentVoucherSchema),
    defaultValues: {
      chequeDate: today(),
      chequeNo: "",
      payee: "",
      debitAccountId: "",
      creditAccountId: "",
      currencyId: currencies[0]?.id ?? "",
      amount: 0,
      narration: "",
    },
  });

  function onSubmit(values: PdcPaymentVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createPdcPaymentVoucher(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Post-dated payment voucher created");
      router.push(`/accounting/vouchers/pdc_payment_voucher/${result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="chequeDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cheque date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="chequeNo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cheque number</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="payee"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Payee</FormLabel>
              <FormControl>
                <Input {...field} />
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
          name="debitAccountId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Debit account (expense/payable)</FormLabel>
              <AccountSelect accounts={accounts} value={field.value} onValueChange={field.onChange} />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="creditAccountId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Credit account (PDC liability)</FormLabel>
              <AccountSelect accounts={accounts} value={field.value} onValueChange={field.onChange} />
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
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
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
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-2 sm:w-fit">
          {isPending ? "Creating…" : "Create PDC payment voucher"}
        </Button>
      </form>
    </Form>
  );
}
