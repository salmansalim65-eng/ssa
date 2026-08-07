import { z } from "zod";

// One opening-balance line: an account with a Debit or a Credit (not both).
export const openingBalanceVoucherLineSchema = z
  .object({
    accountId: z.string().uuid("Select an account"),
    debit: z.coerce.number().nonnegative("Must be zero or more"),
    credit: z.coerce.number().nonnegative("Must be zero or more"),
    remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
  })
  .refine((l) => !(l.debit > 0 && l.credit > 0), {
    message: "A line can't be both debit and credit",
    path: ["credit"],
  });

export const openingBalanceVoucherSchema = z.object({
  asOfDate: z.string().date("Enter a valid date"),
  contraAccountId: z.string().uuid("Select the contra account (e.g. Opening Balance Equity)"),
  costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z
    .array(openingBalanceVoucherLineSchema)
    .min(1, "Add at least one line")
    .refine(
      (lines) => {
        const sumD = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
        const sumC = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
        return Math.max(sumD, sumC) > 0;
      },
      { message: "Enter at least one debit or credit amount" },
    ),
});

export type OpeningBalanceVoucherLineInput = z.output<typeof openingBalanceVoucherLineSchema>;
export type OpeningBalanceVoucherInput = z.output<typeof openingBalanceVoucherSchema>;
export type OpeningBalanceVoucherFormValues = z.input<typeof openingBalanceVoucherSchema>;
