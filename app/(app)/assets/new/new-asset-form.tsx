"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AssetForm } from "@/components/assets/asset-form";
import { createAsset } from "@/features/assets/actions";
import type { AssetInput } from "@/features/assets/schemas";

const emptyValues: AssetInput = {
  assetCode: "",
  assetName: "",
  propertyType: "",
  country: "PK",
  city: "",
  area: "",
  address: "",
  purchaseDate: "",
  purchaseValue: 0,
  currentValue: 0,
  status: "active",
  owner: "",
  notes: "",
};

export function NewAssetForm() {
  const router = useRouter();

  return (
    <AssetForm
      defaultValues={emptyValues}
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
