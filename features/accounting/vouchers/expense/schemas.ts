import { z } from "zod";

/**
 * One expense: what was spent, on which cost centre, under which tag.
 *
 * The cost centre and the tag both live on the LINE. One trip to the bank pays
 * for several things at once — a plumber for one property, fuel for another —
 * and filing the whole voucher under a single cost centre would lose that.
 */
export const expenseVoucherLineSchema = z.object({
  accountId: z.string().uuid("Select the expense account"),
  costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
  tagId: z.string().uuid("Select a tag").optional().or(z.literal("")),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
});

export const expenseVoucherSchema = z.object({
  expenseDate: z.string().date("Enter a valid date"),
  /** The cash or bank account the money left. */
  creditAccountId: z.string().uuid("Select the cash/bank account"),
  paidTo: z.string().trim().max(120, "Keep it under 120 characters").optional().or(z.literal("")),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z
    .array(expenseVoucherLineSchema)
    .min(1, "Add at least one expense line")
    .refine((lines) => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) > 0, {
      message: "Total must be greater than zero",
    }),
});

export type ExpenseVoucherLineInput = z.output<typeof expenseVoucherLineSchema>;
export type ExpenseVoucherInput = z.output<typeof expenseVoucherSchema>;
export type ExpenseVoucherFormValues = z.input<typeof expenseVoucherSchema>;
