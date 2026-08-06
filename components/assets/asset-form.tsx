"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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
import { assetSchema, type AssetFormValues, type AssetInput } from "@/features/assets/schemas";

// A newly-picked country pre-selects its currency (if the company has it).
const COUNTRY_CURRENCY: Record<string, string> = { PK: "PKR", AE: "AED" };

export interface CurrencyOption {
  id: string;
  code: string;
}

export interface CostCenterOption {
  id: string;
  code: string;
  name: string;
}

export function AssetForm({
  defaultValues,
  currencies,
  costCenters,
  onSubmit,
  submitLabel,
}: {
  defaultValues: AssetFormValues;
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
  onSubmit: (values: AssetInput) => Promise<{ error?: string } | undefined>;
  submitLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<AssetFormValues, unknown, AssetInput>({
    resolver: zodResolver(assetSchema),
    defaultValues,
  });

  function handleSubmit(values: AssetInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result?.error) setFormError(result.error);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="assetName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Asset name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="propertyType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Property type</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Apartment, Villa, Office" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Country</FormLabel>
              <Select
                value={field.value}
                onValueChange={(v) => {
                  field.onChange(v);
                  const currency = currencies.find((c) => c.code === COUNTRY_CURRENCY[v]);
                  if (currency) form.setValue("currencyId", currency.id, { shouldValidate: true });
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a country" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="PK">Pakistan</SelectItem>
                  <SelectItem value="AE">United Arab Emirates</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="area"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Area</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="areaSqft"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Area (Sq. Ft)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="owner"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Owner</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="sold">Sold</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="purchaseDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Purchase date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="purchaseValue"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Purchase value</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="currentValue"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current value</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
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
              <Select
                onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                value={field.value || "none"}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {currencies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code}
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
          name="titleDeedValue"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title deed value</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="serviceChargesRate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Service charges rate</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="estimatedRent"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Estimated rent</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="groupCostCenterId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cost center</FormLabel>
              <Select
                onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                defaultValue={field.value || "none"}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {costCenters.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Optional link to another cost center (e.g. a shared building or overhead center) for
                grouping/allocation — separate from this asset&apos;s own dedicated cost center.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
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
