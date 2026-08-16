import { z } from "zod";

// One payment line: debits an Account for an amount (optionally tagged with
// remarks).
export const paymentVoucherLineSchema = z.object({
  accountId: z.string().uuid("Select the account"),
  amount: z.coerce.number().nonnegative("Must be zero or more"),
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
  // Optional bill adjustments: how the line amount is split across the party's
  // outstanding rental invoices as an expense (entered through the dialog).
  allocations: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        country: z.enum(["UAE", "PK"]),
        amount: z.coerce.number().positive(),
      }),
    )
    .optional()
    .default([]),
});

export const paymentVoucherSchema = z.object({
  paymentDate: z.string().date("Enter a valid date"),
  creditAccountId: z.string().uuid("Select the cash/bank account"),
  costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z
    .array(paymentVoucherLineSchema)
    .min(1, "Add at least one line")
    .refine((lines) => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) > 0, {
      message: "Total must be greater than zero",
    }),
});

export type PaymentVoucherLineInput = z.output<typeof paymentVoucherLineSchema>;
export type PaymentVoucherInput = z.output<typeof paymentVoucherSchema>;
export type PaymentVoucherFormValues = z.input<typeof paymentVoucherSchema>;
