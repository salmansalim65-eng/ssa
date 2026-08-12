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
});

// A rental property must be a postable asset account with a country, because
// leases read properties from the Assets module filtered by country.
export const accountSchema = accountBaseSchema.superRefine((val, ctx) => {
  if (!val.isRentalProperty) return;
  if (val.isGroup) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["isRentalProperty"],
      message: "Only posting (non-group) accounts can be rental properties.",
    });
  }
  if (val.accountType !== "asset") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["isRentalProperty"],
      message: "Only asset-type accounts can be rental properties.",
    });
  }
  if (!val.country) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["country"],
      message: "Select a country so the property appears in that country's leases.",
    });
  }
});

export type AccountInput = z.output<typeof accountSchema>;
export type AccountFormValues = z.input<typeof accountSchema>;
