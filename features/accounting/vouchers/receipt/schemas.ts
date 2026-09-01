import { z } from "zod";

// One receipt line: credits an Account for an amount (optionally tagged with a
// rent month and remarks).
export const receiptVoucherLineSchema = z.object({
  accountId: z.string().uuid("Select the account"),
  amount: z.coerce.number().nonnegative("Must be zero or more"),
  // Picked by month name; stored as the first day of that month.
  rentMonth: z.string().date("Pick a valid rent month").optional().or(z.literal("")),
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
  // Optional bill adjustments: how the line amount is split across the party's
  // outstanding rental invoices (entered through the adjustment dialog).
  allocations: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        // "rental" applies to a rental invoice; "jv" settles an open Journal
        // Voucher ledger item on the party account.
        source: z.enum(["rental", "jv"]).optional().default("rental"),
        country: z.enum(["UAE", "PK"]),
        amount: z.coerce.number().positive(),
      }),
    )
    .optional()
    .default([]),
});

export const receiptVoucherSchema = z.object({
  receiptDate: z.string().date("Enter a valid date"),
  debitAccountId: z.string().uuid("Select the cash/bank account"),
  costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z
    .array(receiptVoucherLineSchema)
    .min(1, "Add at least one line")
    .refine((lines) => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) > 0, {
      message: "Total must be greater than zero",
    }),
});

export type ReceiptVoucherLineInput = z.output<typeof receiptVoucherLineSchema>;
export type ReceiptVoucherInput = z.output<typeof receiptVoucherSchema>;
export type ReceiptVoucherFormValues = z.input<typeof receiptVoucherSchema>;
