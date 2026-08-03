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
import { createOpeningBalanceVoucher } from "@/features/accounting/vouchers/opening-balance/actions";
import {
  openingBalanceVoucherSchema,
  type OpeningBalanceVoucherFormValues,
  type OpeningBalanceVoucherInput,
} from "@/features/accounting/vouchers/opening-balance/schemas";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function OpeningBalanceVoucherForm({
  accounts,
  currencies,
}: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<OpeningBalanceVoucherFormValues, unknown, OpeningBalanceVoucherInput>({
    resolver: zodResolver(openingBalanceVoucherSchema),
    defaultValues: {
      asOfDate: today(),
      accountId: "",
      contraAccountId: "",
      currencyId: currencies[0]?.id ?? "",
      debitAmount: 0,
      creditAmount: 0,
    },
  });

  function onSubmit(values: OpeningBalanceVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createOpeningBalanceVoucher(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Opening balance voucher created");
      router.push(`/accounting/vouchers/opening_balance_voucher/${result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="asOfDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>As of date</FormLabel>
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
          name="accountId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Account</FormLabel>
              <AccountSelect accounts={accounts} value={field.value} onValueChange={field.onChange} />
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
              <AccountSelect accounts={accounts} value={field.value} onValueChange={field.onChange} />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="debitAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Debit amount</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="creditAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Credit amount</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-2 sm:w-fit">
          {isPending ? "Creating…" : "Create opening balance voucher"}
        </Button>
      </form>
    </Form>
  );
}
