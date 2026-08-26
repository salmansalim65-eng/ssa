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
import { createPkLease, updatePkLease } from "@/features/rental/pk-leases/actions";
import {
  pkLeaseSchema,
  type PkLeaseFormValues,
  type PkLeaseInput,
} from "@/features/rental/pk-leases/schemas";

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

export function PkLeaseForm({
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
  initialValues?: PkLeaseFormValues;
}) {
  const router = useRouter();
  const isEdit = !!leaseId;
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<PkLeaseFormValues, unknown, PkLeaseInput>({
    resolver: zodResolver(pkLeaseSchema),
    defaultValues: initialValues ?? {
      assetId: "",
      tenantId: "",
      leaseStart: today(),
      leaseEnd: today(),
      monthlyRent: blankAmount,
      officialRent: blankAmount,
      rentCycle: "yearly",
      advanceRent: blankAmount,
      securityDeposit: blankAmount,
      currencyId: defaultCurrencyId ?? currencies[0]?.id ?? "",
      dueDate: "",
      voucherDate: today(),
      remarks: "",
    },
  });

  function onSubmit(values: PkLeaseInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit ? await updatePkLease(leaseId!, values) : await createPkLease(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success(isEdit ? "Lease updated" : "Lease created");
      if (!isEdit && result && "invoiceWarning" in result && result.invoiceWarning)
        toast.warning(result.invoiceWarning as string);
      router.push(`/rental/pk/leases/${isEdit ? leaseId : result.id}`);
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
                      {a.asset_name}
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
          name="monthlyRent"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Monthly rent</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="officialRent"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Official rent</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
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
                    <SelectValue placeholder="Select rent cycle" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="advanceRent"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Advance rent</FormLabel>
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
        <FormField
          control={form.control}
          name="voucherDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Voucher date</FormLabel>
              <FormControl>
                <Input type="date" {...field} value={(field.value as string) ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="remarks"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Remarks</FormLabel>
              <FormControl>
                <Input placeholder="Optional notes for this lease" {...field} value={(field.value as string) ?? ""} />
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
