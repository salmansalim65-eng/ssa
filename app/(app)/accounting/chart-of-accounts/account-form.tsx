"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  ACCOUNT_TYPES,
  accountSchema,
  type AccountFormValues,
  type AccountInput,
} from "@/features/accounting/chart-of-accounts/schemas";

const typeLabels: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  asset: "Asset",
  liability: "Liability",
  income: "Income",
  expense: "Expense",
  equity: "Equity",
};

export interface ParentOption {
  id: string;
  account_code: string;
  account_name: string;
  account_type: (typeof ACCOUNT_TYPES)[number];
}

export interface CurrencyOption {
  id: string;
  code: string;
}

export function AccountForm({
  defaultValues,
  parentOptions,
  currencies,
  onSubmit,
  submitLabel,
}: {
  defaultValues: AccountInput;
  parentOptions: ParentOption[];
  currencies: CurrencyOption[];
  onSubmit: (values: AccountInput) => Promise<{ error?: string } | undefined>;
  submitLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<AccountFormValues, unknown, AccountInput>({
    resolver: zodResolver(accountSchema),
    defaultValues,
  });

  const isGroup = useWatch({ control: form.control, name: "isGroup" });
  const selectedParentId = useWatch({ control: form.control, name: "parentId" });
  const selectedParent = parentOptions.find((p) => p.id === selectedParentId);
  const lockAccountType = Boolean(selectedParent);

  function handleParentChange(value: string, onChange: (value: string) => void) {
    const parentId = value === "none" ? "" : value;
    onChange(parentId);
    const parent = parentOptions.find((p) => p.id === parentId);
    if (parent) form.setValue("accountType", parent.account_type);
  }

  function handleSubmit(values: AccountInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result?.error) setFormError(result.error);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="accountName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Account name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="parentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Parent account</FormLabel>
              <Select
                onValueChange={(value) => handleParentChange(value, field.onChange)}
                defaultValue={field.value || "none"}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">No parent (root)</SelectItem>
                  {parentOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.account_code} — {p.account_name}
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
          name="accountType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Account type</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                disabled={lockAccountType}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {typeLabels[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lockAccountType && (
                <FormDescription>Inherited from the parent account.</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="currencyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Restrict to currency</FormLabel>
              <Select
                onValueChange={(value) => field.onChange(value === "base" ? "" : value)}
                defaultValue={field.value || "base"}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="base">Company base currency</SelectItem>
                  {currencies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Only this currency can post to the account.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="openingBalance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Opening balance</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  disabled={isGroup}
                  {...field}
                  value={field.value as number}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="isGroup"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-2 sm:col-span-2">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Group / header account</FormLabel>
                <FormDescription>
                  Groups organize the tree and can have child accounts, but
                  can&apos;t be posted to directly.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="isCash"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-2 sm:col-span-2">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Cash account</FormLabel>
                <FormDescription>Included in the Cash Book report.</FormDescription>
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="isBank"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-2 sm:col-span-2">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Bank account</FormLabel>
                <FormDescription>Included in the Bank Book report.</FormDescription>
              </div>
            </FormItem>
          )}
        />
        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-2 sm:w-fit">
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
