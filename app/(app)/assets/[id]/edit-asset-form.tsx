"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AssetForm,
  type CostCenterOption,
  type CountryOption,
  type CurrencyOption,
} from "@/components/assets/asset-form";
import { updateAsset } from "@/features/assets/actions";
import type { AssetInput } from "@/features/assets/schemas";

export function EditAssetForm({
  assetId,
  defaultValues,
  currencies,
  costCenters,
  countries,
  canAddCountry,
}: {
  assetId: string;
  defaultValues: AssetInput;
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
  countries: CountryOption[];
  canAddCountry: boolean;
}) {
  const router = useRouter();

  return (
    <AssetForm
      defaultValues={defaultValues}
      currencies={currencies}
      costCenters={costCenters}
      countries={countries}
      canAddCountry={canAddCountry}
      submitLabel="Save changes"
      onSubmit={async (values) => {
        const result = await updateAsset(assetId, values);
        if (result?.error) return result;
        toast.success("Asset updated");
        router.refresh();
        return undefined;
      }}
    />
  );
}
