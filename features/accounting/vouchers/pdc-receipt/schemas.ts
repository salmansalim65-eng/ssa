import { z } from "zod";

// One line credits an Account for an amount (optional rent month + remarks).
export const pdcReceiptVoucherLineSchema = z.object({
  accountId: z.string().uuid("Select the account"),
  amount: z.coerce.number().nonnegative("Must be zero or more"),
  rentMonth: z.string().date("Enter a valid date").optional().or(z.literal("")),
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
  // How the line amount is applied against the party's outstanding rental
  // invoices (entered through the adjustment dialog) — same as a Receipt.
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

export const pdcReceiptVoucherSchema = z.object({
  chequeDate: z.string().date("Enter a valid date"),
  dueDate: z.string().date("Enter a valid date").optional().or(z.literal("")),
  chequeNo: z.string().min(1, "Required"),
  payer: z.string().min(1, "Required"),
  debitAccountId: z.string().uuid("Select the PDC asset account"),
  costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z
    .array(pdcReceiptVoucherLineSchema)
    .min(1, "Add at least one line")
    .refine((lines) => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) > 0, {
      message: "Total must be greater than zero",
    }),
});

export type PdcReceiptVoucherLineInput = z.output<typeof pdcReceiptVoucherLineSchema>;
export type PdcReceiptVoucherInput = z.output<typeof pdcReceiptVoucherSchema>;
export type PdcReceiptVoucherFormValues = z.input<typeof pdcReceiptVoucherSchema>;
