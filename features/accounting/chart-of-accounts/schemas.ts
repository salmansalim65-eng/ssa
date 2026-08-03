import { z } from "zod";

export const ACCOUNT_TYPES = ["asset", "liability", "income", "expense", "equity"] as const;

export const accountSchema = z.object({
  accountCode: z.string().min(1, "Account code is required").max(30),
  accountName: z.string().min(2, "Account name is required").max(200),
  parentId: z.string().uuid().optional().or(z.literal("")),
  accountType: z.enum(ACCOUNT_TYPES, { message: "Select an account type" }),
  currencyId: z.string().uuid().optional().or(z.literal("")),
  isGroup: z.boolean(),
  openingBalance: z.coerce.number(),
});

export type AccountInput = z.output<typeof accountSchema>;
export type AccountFormValues = z.input<typeof accountSchema>;
