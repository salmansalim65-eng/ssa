import { z } from "zod";

export const ACCOUNT_TYPES = ["asset", "liability", "income", "expense", "equity"] as const;

export const accountSchema = z.object({
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
});

export type AccountInput = z.output<typeof accountSchema>;
export type AccountFormValues = z.input<typeof accountSchema>;
