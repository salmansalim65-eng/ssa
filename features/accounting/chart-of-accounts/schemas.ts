import { z } from "zod";

export const ACCOUNT_TYPES = ["asset", "liability", "income", "expense", "equity"] as const;

export const accountBaseSchema = z.object({
  // account_code is auto-generated server-side (core.fn_next_master_code),
  // mirroring Assets and Cost Centers; it is never entered or edited by hand.
  accountName: z.string().min(2, "Account name is required").max(200),
  parentId: z.string().uuid().optional().or(z.literal("")),
  accountType: z.enum(ACCOUNT_TYPES, { message: "Select an account type" }),
  currencyId: z.string().uuid().optional().or(z.literal("")),
  isGroup: z.boolean(),
  openingBalance: z.coerce.number(),
  isCash: z.boolean(),
  isBank: z.boolean(),
  // Marks a group account as THE tenant group leases pick tenants from.
  isTenantGroup: z.boolean().default(false),
  // Marks a posting asset account as a rental property. When set, the app
  // auto-creates (and keeps in step with) a matching property in the Assets
  // module so it becomes selectable in leases for its country.
  isRentalProperty: z.boolean().default(false),
  // Details tab — party info, most relevant to tenant/party accounts.
  idNumber: z.string().max(100).optional().or(z.literal("")),
  contactPerson: z.string().max(200).optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  email: z.string().max(200).optional().or(z.literal("")),
  country: z.string().max(10).optional().or(z.literal("")),
  // The cost centre this account's postings belong to. Optional: an account
  // that has no cost centre of its own simply leaves it unset.
  defaultCostCenterId: z.string().uuid().optional().or(z.literal("")),
  // Property (asset) details — surfaced in the form when the account sits under
  // the PROPERTIES group (or is already a linked property), so a property can be
  // fully described and managed from Chart of Accounts. These are written
  // through to the linked asset in the Assets module.
  propertyType: z.string().max(100).optional().or(z.literal("")),
  propertyStatus: z.enum(["active", "inactive", "sold"]).default("active"),
  city: z.string().max(200).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  owner: z.string().max(200).optional().or(z.literal("")),
  officialOwner: z.string().max(200).optional().or(z.literal("")),
  purchaseDate: z.string().optional().or(z.literal("")),
  areaSqft: z.coerce.number().nonnegative().default(0),
  areaUnit: z.string().max(50).optional().or(z.literal("")),
  purchaseValue: z.coerce.number().nonnegative().default(0),
  currentValue: z.coerce.number().nonnegative().default(0),
  titleDeedValue: z.coerce.number().nonnegative().default(0),
  serviceChargesRate: z.coerce.number().nonnegative().default(0),
  propertyTax: z.coerce.number().nonnegative().default(0),
  otherCharges: z.coerce.number().nonnegative().default(0),
  estimatedRent: z.coerce.number().nonnegative().default(0),
  propertyNotes: z.string().max(1000).optional().or(z.literal("")),
});

// The rental flag only makes sense on a postable (non-group) account. It does
// NOT require a country here — a property with no country simply won't appear in
// any lease dropdown until one is set, rather than blocking the save. (Country
// for a property is captured in the Property details section.)
export const accountSchema = accountBaseSchema.superRefine((val, ctx) => {
  if (val.isRentalProperty && val.isGroup) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["isRentalProperty"],
      message: "Only posting (non-group) accounts can be rental properties.",
    });
  }
});

export type AccountInput = z.output<typeof accountSchema>;
export type AccountFormValues = z.input<typeof accountSchema>;
