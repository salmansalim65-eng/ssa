"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AssetForm,
  type CostCenterOption,
  type CountryOption,
  type CurrencyOption,
} from "@/components/assets/asset-form";
import { createAsset } from "@/features/assets/actions";
import type { AssetFormValues } from "@/features/assets/schemas";
import { blankAmount } from "@/lib/forms/amount";

function today() {
  return new Date().toISOString().slice(0, 10);
}

const emptyValues: AssetFormValues = {
  assetName: "",
  propertyType: "",
  country: "",
  city: "",
  area: "",
  areaSqft: blankAmount,
  areaUnit: "",
  address: "",
  purchaseDate: "",
  purchaseValue: blankAmount,
  currentValue: blankAmount,
  currencyId: "",
  serviceChargesRate: blankAmount,
  propertyTax: blankAmount,
  titleDeedValue: blankAmount,
  otherCharges: blankAmount,
  estimatedRent: blankAmount,
  status: "active",
  owner: "",
  officialOwner: "",
  costCenterMode: "new",
  groupCostCenterId: "",
  notes: "",
  valueEffectiveDate: today(),
  valueRemarks: "",
};

export function NewAssetForm({
  currencies,
  costCenters,
  countries,
  canAddCountry,
}: {
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
  countries: CountryOption[];
  canAddCountry: boolean;
}) {
  const router = useRouter();

  return (
    <AssetForm
      defaultValues={emptyValues}
      currencies={currencies}
      costCenters={costCenters}
      countries={countries}
      canAddCountry={canAddCountry}
      submitLabel="Create asset"
      onSubmit={async (values) => {
        const result = await createAsset(values);
        if (result?.error) return result;
        toast.success("Asset created successfully.");
        router.push("/assets");
        return undefined;
      }}
    />
  );
}
