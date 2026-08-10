import { z } from "zod";

export const assetSchema = z.object({
  assetName: z.string().min(2, "Asset name is required").max(200),
  propertyType: z.string().min(1, "Property type is required"),
  // Any non-empty country code from the per-company country master. Empty is
  // allowed as the initial form value but rejected on submit so the field must
  // be chosen explicitly.
  country: z.string().min(1, "Select a country"),
  city: z.string().optional().or(z.literal("")),
  area: z.string().optional().or(z.literal("")),
  areaSqft: z.coerce.number().nonnegative(),
  areaUnit: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  purchaseDate: z.string().optional().or(z.literal("")),
  purchaseValue: z.coerce.number().nonnegative(),
  currentValue: z.coerce.number().nonnegative(),
  currencyId: z.string().uuid().optional().or(z.literal("")),
  serviceChargesRate: z.coerce.number().nonnegative(),
  titleDeedValue: z.coerce.number().nonnegative(),
  otherCharges: z.coerce.number().nonnegative(),
  estimatedRent: z.coerce.number().nonnegative(),
  status: z.enum(["active", "sold", "inactive"]),
  owner: z.string().optional().or(z.literal("")),
  officialOwner: z.string().optional().or(z.literal("")),
  // Cost-center handling: 'new' auto-creates a dedicated cost center, 'none'
  // links nothing, 'existing' links the cost center in groupCostCenterId.
  costCenterMode: z.enum(["new", "none", "existing"]).default("new"),
  groupCostCenterId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  // Value-history metadata — applied only when currentValue actually changes.
  valueEffectiveDate: z.string().optional().or(z.literal("")),
  valueRemarks: z.string().optional().or(z.literal("")),
});

export type AssetInput = z.output<typeof assetSchema>;
export type AssetFormValues = z.input<typeof assetSchema>;
