"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { upsertExchangeRate } from "@/features/admin/exchange-rates/actions";
import {
  exchangeRateSchema,
  type ExchangeRateFormValues,
  type ExchangeRateInput,
} from "@/features/admin/exchange-rates/schemas";

export interface RateableCurrency {
  id: string;
  code: string;
  name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function ExchangeRateForm({ currencies }: { currencies: RateableCurrency[] }) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ExchangeRateFormValues, unknown, ExchangeRateInput>({
    resolver: zodResolver(exchangeRateSchema),
    defaultValues: { currencyId: "", rateDate: today(), rateToBase: 0 },
  });

  function onSubmit(values: ExchangeRateInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await upsertExchangeRate(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Exchange rate saved");
      form.resetField("rateToBase");
    });
  }

  if (currencies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Enable a non-base currency for this company under Currencies first.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid max-w-2xl gap-4 sm:grid-cols-3"
      >
        <FormField
          control={form.control}
          name="currencyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Currency</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
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
          name="rateDate"
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
          name="rateToBase"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rate to base</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.000001"
                  min="0"
                  {...field}
                  value={field.value as number}
                />
              </FormControl>
              <FormDescription>1 unit of this currency = this many base units.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {formError && <p className="text-sm text-destructive sm:col-span-3">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-3 sm:w-fit">
          {isPending ? "Saving…" : "Save rate"}
        </Button>
      </form>
    </Form>
  );
}
