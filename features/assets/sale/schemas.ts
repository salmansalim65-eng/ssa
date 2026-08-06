import { z } from "zod";

// One sold-property line: credits a Fixed Asset (Property) account for its gross.
export const assetSaleLineSchema = z.object({
  fixedAssetAccountId: z.string().uuid("Select the fixed asset (property) account"),
  gross: z.coerce.number().nonnegative("Must be zero or more"),
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
});

export const assetSaleSchema = z.object({
  customerAccountId: z.string().uuid("Select the customer account"),
  assetId: z.string().uuid("Select an asset").optional().or(z.literal("")),
  saleDate: z.string().date("Enter a valid date"),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  pakExch: z.coerce.number().nonnegative().default(0),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z
    .array(assetSaleLineSchema)
    .min(1, "Add at least one line")
    .refine((lines) => lines.reduce((sum, l) => sum + (Number(l.gross) || 0), 0) > 0, {
      message: "Total value must be greater than zero",
    }),
});

export type AssetSaleLineInput = z.output<typeof assetSaleLineSchema>;
export type AssetSaleInput = z.output<typeof assetSaleSchema>;
export type AssetSaleFormValues = z.input<typeof assetSaleSchema>;
