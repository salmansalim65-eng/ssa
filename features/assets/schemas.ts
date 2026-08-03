import { z } from "zod";

export const assetSchema = z.object({
  assetCode: z.string().min(1, "Asset code is required").max(30),
  assetName: z.string().min(2, "Asset name is required").max(200),
  propertyType: z.string().min(1, "Property type is required"),
  country: z.enum(["PK", "AE"], { message: "Select a country" }),
  city: z.string().optional().or(z.literal("")),
  area: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  purchaseDate: z.string().optional().or(z.literal("")),
  purchaseValue: z.coerce.number().nonnegative(),
  currentValue: z.coerce.number().nonnegative(),
  status: z.enum(["active", "sold", "inactive"]),
  owner: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export type AssetInput = z.output<typeof assetSchema>;
export type AssetFormValues = z.input<typeof assetSchema>;
