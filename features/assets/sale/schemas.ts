import { z } from "zod";

export const assetSaleSchema = z.object({
  assetId: z.string().uuid("Select an asset"),
  buyer: z.string().min(2, "Buyer name is required").max(200),
  saleDate: z.string().date("Enter a valid date"),
  salePrice: z.coerce.number().positive("Must be greater than zero"),
  currencyId: z.string().uuid("Select a currency"),
});

export type AssetSaleInput = z.output<typeof assetSaleSchema>;
export type AssetSaleFormValues = z.input<typeof assetSaleSchema>;
