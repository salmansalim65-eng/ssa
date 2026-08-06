"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AssetForm, type CostCenterOption, type CurrencyOption } from "@/components/assets/asset-form";
import { createAsset } from "@/features/assets/actions";
import type { AssetFormValues } from "@/features/assets/schemas";

const emptyValues: AssetFormValues = {
  assetName: "",
  propertyType: "",
  country: "",
  city: "",
  area: "",
  areaSqft: 0,
  address: "",
  purchaseDate: "",
  purchaseValue: 0,
  currentValue: 0,
  currencyId: "",
  serviceChargesRate: 0,
  titleDeedValue: 0,
  estimatedRent: 0,
  status: "active",
  owner: "",
  groupCostCenterId: "",
  notes: "",
};

export function NewAssetForm({
  currencies,
  costCenters,
}: {
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
}) {
  const router = useRouter();

  return (
    <AssetForm
      defaultValues={emptyValues}
      currencies={currencies}
      costCenters={costCenters}
      submitLabel="Create asset"
      onSubmit={async (values) => {
        const result = await createAsset(values);
        if (result?.error) return result;
        toast.success("Asset created");
        router.push(`/assets/${result.id}`);
        return undefined;
      }}
    />
  );
}
