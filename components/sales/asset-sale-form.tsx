"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
import { CurrencySelect, type CurrencyOption } from "@/components/vouchers/currency-select";
import { AccountCombobox, type AccountOption } from "@/components/vouchers/account-combobox";
import { DateInput } from "@/components/vouchers/date-input";
import { createAssetSale } from "@/features/assets/sale/actions";
import { assetSaleSchema, type AssetSaleFormValues, type AssetSaleInput } from "@/features/assets/sale/schemas";

export interface SellableAssetOption {
  id: string;
  asset_code: string;
  asset_name: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { fixedAssetAccountId: "", gross: 0, remarks: "" };
}

export function AssetSaleForm({
  assets,
  accounts,
  currencies,
}: {
  assets: SellableAssetOption[];
  accounts: AccountOption[];
  currencies: CurrencyOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const preselectedAssetId = searchParams.get("assetId") ?? "";
  const rateById = new Map(currencies.map((c) => [c.id, c.rate ?? 1] as const));

  const form = useForm<AssetSaleFormValues, unknown, AssetSaleInput>({
    resolver: zodResolver(assetSaleSchema),
    defaultValues: {
      customerAccountId: "",
      assetId: assets.some((a) => a.id === preselectedAssetId) ? preselectedAssetId : "",
      saleDate: today(),
      currencyId: currencies[0]?.id ?? "",
      exchangeRate: currencies[0]?.rate ?? 1,
      pakExch: 0,
      narration: "",
      lines: [emptyLine()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const totalValue = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.gross) || 0), 0);

  function onSubmit(values: AssetSaleInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createAssetSale(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Sale asset voucher created");
      router.push(`/sales/${result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Voucher header */}
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormItem>
            <FormLabel>Document No.</FormLabel>
            <Input value="Auto" disabled readOnly />
          </FormItem>
          <FormField
            control={form.control}
            name="saleDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl>
                  <DateInput {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="customerAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Customer (Dr)</FormLabel>
                <AccountCombobox accounts={accounts} value={field.value} onValueChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="assetId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Asset</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select asset (optional)" />
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
            name="currencyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency</FormLabel>
                <CurrencySelect
                  currencies={currencies}
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    form.setValue("exchangeRate", rateById.get(v) ?? 1, { shouldValidate: true });
                  }}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="exchangeRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency Conv.</FormLabel>
                <FormControl>
                  <Input type="number" step="0.0001" min="0" {...field} value={field.value as number} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pakExch"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pak. Exch</FormLabel>
                <FormControl>
                  <Input type="number" step="0.0001" min="0" {...field} value={field.value as number} />
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
                  <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Sold-property line grid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Properties</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <PlusIcon className="size-4" /> Add row
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
                  <th className="w-10">Sno</th>
                  <th className="min-w-[240px]">Fixed Asset (Property) (Cr)</th>
                  <th className="w-40">Gross</th>
                  <th className="min-w-[200px]">Remarks</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((line, index) => (
                  <tr key={line.id} className="border-b align-top [&_td]:px-2 [&_td]:py-2">
                    <td className="pt-4 text-muted-foreground">{index + 1}</td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.fixedAssetAccountId`}
                        render={({ field }) => (
                          <FormItem>
                            <AccountCombobox accounts={accounts} value={field.value} onValueChange={field.onChange} />
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.gross`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.remarks`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={fields.length === 1}
                        onClick={() => remove(index)}
                        aria-label="Remove row"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-right text-sm font-medium">Total Value: {totalValue.toLocaleString()}</p>
        </div>

        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:w-fit">
          {isPending ? "Creating…" : "Create sale asset voucher"}
        </Button>
      </form>
    </Form>
  );
}
