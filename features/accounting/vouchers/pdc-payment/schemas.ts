import { z } from "zod";

// One line debits an Account for an amount (optional rent month + remarks).
export const pdcPaymentVoucherLineSchema = z.object({
  accountId: z.string().uuid("Select the account"),
  amount: z.coerce.number().nonnegative("Must be zero or more"),
  rentMonth: z.string().date("Enter a valid date").optional().or(z.literal("")),
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
});

export const pdcPaymentVoucherSchema = z.object({
  chequeDate: z.string().date("Enter a valid date"),
  dueDate: z.string().date("Enter a valid date").optional().or(z.literal("")),
  chequeNo: z.string().min(1, "Required"),
  payee: z.string().min(1, "Required"),
  creditAccountId: z.string().uuid("Select the PDC liability account"),
  costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z
    .array(pdcPaymentVoucherLineSchema)
    .min(1, "Add at least one line")
    .refine((lines) => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) > 0, {
      message: "Total must be greater than zero",
    }),
});

export type PdcPaymentVoucherLineInput = z.output<typeof pdcPaymentVoucherLineSchema>;
export type PdcPaymentVoucherInput = z.output<typeof pdcPaymentVoucherSchema>;
export type PdcPaymentVoucherFormValues = z.input<typeof pdcPaymentVoucherSchema>;
