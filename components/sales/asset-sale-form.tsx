"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { createAssetSale } from "@/features/assets/sale/actions";
import {
  assetSaleSchema,
  type AssetSaleFormValues,
  type AssetSaleInput,
} from "@/features/assets/sale/schemas";

export interface SellableAssetOption {
  id: string;
  asset_code: string;
  asset_name: string;
  current_value: number | null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function AssetSaleForm({
  assets,
  currencies,
}: {
  assets: SellableAssetOption[];
  currencies: CurrencyOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const preselectedAssetId = searchParams.get("assetId") ?? "";

  const form = useForm<AssetSaleFormValues, unknown, AssetSaleInput>({
    resolver: zodResolver(assetSaleSchema),
    defaultValues: {
      assetId: assets.some((a) => a.id === preselectedAssetId) ? preselectedAssetId : "",
      buyer: "",
      saleDate: today(),
      salePrice: 0,
      currencyId: currencies[0]?.id ?? "",
    },
  });

  const watched = useWatch({ control: form.control });
  const selectedAsset = assets.find((a) => a.id === watched.assetId);
  const bookValue = selectedAsset?.current_value ?? 0;
  const profitLoss = (Number(watched.salePrice) || 0) - bookValue;

  function onSubmit(values: AssetSaleInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createAssetSale(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Asset sale created");
      router.push(`/sales/${result.id}`);
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
                    <SelectValue placeholder="Select the asset being sold" />
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
          name="buyer"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Buyer</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="saleDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sale date</FormLabel>
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
          name="salePrice"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sale price</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {selectedAsset && (
          <div className="space-y-1 rounded-md border p-3 text-sm sm:col-span-2">
            <p>Book value: {bookValue.toLocaleString()}</p>
            <p className={profitLoss >= 0 ? "text-success" : "text-destructive"}>
              {profitLoss >= 0 ? "Projected gain" : "Projected loss"}: {Math.abs(profitLoss).toLocaleString()}
            </p>
          </div>
        )}

        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-2 sm:w-fit">
          {isPending ? "Creating…" : "Create asset sale"}
        </Button>
      </form>
    </Form>
  );
}
