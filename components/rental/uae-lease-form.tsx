"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { createUaeLease, updateUaeLease } from "@/features/rental/uae-leases/actions";
import {
  uaeLeaseSchema,
  type UaeLeaseFormValues,
  type UaeLeaseInput,
} from "@/features/rental/uae-leases/schemas";

export interface AssetOption {
  id: string;
  asset_code: string;
  asset_name: string;
}

export interface TenantOption {
  id: string;
  name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function UaeLeaseForm({
  assets,
  tenants,
  currencies,
  defaultCurrencyId,
  leaseId,
  initialValues,
}: {
  assets: AssetOption[];
  tenants: TenantOption[];
  currencies: CurrencyOption[];
  defaultCurrencyId?: string;
  leaseId?: string;
  initialValues?: UaeLeaseFormValues;
}) {
  const router = useRouter();
  const isEdit = !!leaseId;
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<UaeLeaseFormValues, unknown, UaeLeaseInput>({
    resolver: zodResolver(uaeLeaseSchema),
    defaultValues: initialValues ?? {
      assetId: "",
      tenantId: "",
      leaseStart: today(),
      leaseEnd: today(),
      rentalAmount: blankAmount,
      rentCycle: "monthly",
      securityDeposit: blankAmount,
      currencyId: defaultCurrencyId ?? currencies[0]?.id ?? "",
      dueDate: "",
    },
  });

  function onSubmit(values: UaeLeaseInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit ? await updateUaeLease(leaseId!, values) : await createUaeLease(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success(isEdit ? "Lease updated" : "Lease created");
      router.push(`/rental/uae/leases/${isEdit ? leaseId : result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-2xl gap-4 sm:grid-cols-2">
        {isEdit && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm sm:col-span-2">
            Saving regenerates this lease&apos;s payment schedule from the new terms and removes any
            <strong> unposted</strong> invoices. Leases with a posted invoice can&apos;t be edited.
          </p>
        )}
        <FormField
          control={form.control}
          name="assetId"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Asset</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select the property being leased" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.asset_code} — {a.asset_name}
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
          name="tenantId"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
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
          name="leaseStart"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Lease start</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="leaseEnd"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Lease end</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
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
          name="rentalAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rental amount (per cycle)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="securityDeposit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Security deposit</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="dueDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Due date (optional)</FormLabel>
              <FormControl>
                <Input type="date" {...field} value={(field.value as string) ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {formError &&<p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-2 sm:w-fit">
          {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create lease"}
        </Button>
      </form>
    </Form>
  );
}
