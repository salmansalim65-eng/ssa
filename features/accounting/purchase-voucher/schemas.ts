import { z } from "zod";

export const purchaseVoucherSchema = z.object({
  assetId: z.string().uuid("Select an asset"),
  supplierId: z.string().uuid("Select a supplier"),
  fixedAssetAccountId: z.string().uuid("Select the fixed asset account"),
  vendorAccountId: z.string().uuid("Select the vendor account"),
  purchaseDate: z.string().date("Enter a valid date"),
  currencyId: z.string().uuid("Select a currency"),
  purchasePrice: z.coerce.number().nonnegative(),
  taxes: z.coerce.number().nonnegative(),
  registrationCharges: z.coerce.number().nonnegative(),
  additionalExpenses: z.coerce.number().nonnegative(),
});

export type PurchaseVoucherInput = z.output<typeof purchaseVoucherSchema>;
export type PurchaseVoucherFormValues = z.input<typeof purchaseVoucherSchema>;
