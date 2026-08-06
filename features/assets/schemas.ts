import { z } from "zod";

export const assetSchema = z.object({
  assetName: z.string().min(2, "Asset name is required").max(200),
  propertyType: z.string().min(1, "Property type is required"),
  // Empty is allowed as the initial form value but rejected on submit, so the
  // country field can default to blank and force an explicit choice.
  country: z.string().min(1, "Select a country").pipe(z.enum(["PK", "AE"])),
  city: z.string().optional().or(z.literal("")),
  area: z.string().optional().or(z.literal("")),
  areaSqft: z.coerce.number().nonnegative(),
  address: z.string().optional().or(z.literal("")),
  purchaseDate: z.string().optional().or(z.literal("")),
  purchaseValue: z.coerce.number().nonnegative(),
  currentValue: z.coerce.number().nonnegative(),
  currencyId: z.string().uuid().optional().or(z.literal("")),
  serviceChargesRate: z.coerce.number().nonnegative(),
  titleDeedValue: z.coerce.number().nonnegative(),
  estimatedRent: z.coerce.number().nonnegative(),
  status: z.enum(["active", "sold", "inactive"]),
  owner: z.string().optional().or(z.literal("")),
  groupCostCenterId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export type AssetInput = z.output<typeof assetSchema>;
export type AssetFormValues = z.input<typeof assetSchema>;
