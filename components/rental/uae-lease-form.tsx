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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencySelect, type CurrencyOption } from "@/components/vouchers/currency-select";
import { createUaeLease } from "@/features/rental/uae-leases/actions";
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
}: {
  assets: AssetOption[];
  tenants: TenantOption[];
  currencies: CurrencyOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<UaeLeaseFormValues, unknown, UaeLeaseInput>({
    resolver: zodResolver(uaeLeaseSchema),
    defaultValues: {
      assetId: "",
      tenantId: "",
      leaseStart: today(),
      leaseEnd: today(),
      rentalAmount: 0,
      rentCycle: "monthly",
      securityDeposit: 0,
      currencyId: currencies[0]?.id ?? "",
      dueDate: "",
      rentMonth: "",
    },
  });

  function onSubmit(values: UaeLeaseInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createUaeLease(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Lease created");
      router.push(`/rental/uae/leases/${result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-2xl gap-4 sm:grid-cols-2">
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
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
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
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
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
        <FormField
          control={form.control}
          name="rentMonth"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rent month (optional)</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Aug-2026" {...field} value={(field.value as string) ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-2 sm:w-fit">
          {isPending ? "Creating…" : "Create lease"}
        </Button>
      </form>
    </Form>
  );
}
