import { z } from "zod";

// One asset line of the purchase voucher grid.
export const purchaseVoucherLineSchema = z.object({
  assetId: z.string().uuid("Select an asset"),
  fixedAssetAccountId: z.string().uuid("Select the fixed asset account"),
  gross: z.coerce.number().nonnegative("Must be zero or more"),
  dueDate: z.string().date("Enter a valid date").optional().or(z.literal("")),
  installmentMonth: z.string().trim().max(50, "Keep it under 50 characters").optional().or(z.literal("")),
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
});

export const purchaseVoucherSchema = z.object({
  supplierId: z.string().uuid("Select a supplier"),
  vendorAccountId: z.string().uuid("Select the vendor account"),
  purchaseDate: z.string().date("Enter a valid date"),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  paymentTerms: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
  sharePercentage: z.coerce.number().min(0).max(100, "0–100").default(0),
  lines: z
    .array(purchaseVoucherLineSchema)
    .min(1, "Add at least one asset line")
    .refine((lines) => lines.reduce((sum, l) => sum + (Number(l.gross) || 0), 0) > 0, {
      message: "Total value must be greater than zero",
    }),
});

export type PurchaseVoucherLineInput = z.output<typeof purchaseVoucherLineSchema>;
export type PurchaseVoucherInput = z.output<typeof purchaseVoucherSchema>;
export type PurchaseVoucherFormValues = z.input<typeof purchaseVoucherSchema>;
