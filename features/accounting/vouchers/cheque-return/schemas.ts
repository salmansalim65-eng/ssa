import { z } from "zod";

export const chequeReturnVoucherSchema = z
  .object({
    originalPdcType: z.enum(["pdc_payment_voucher", "pdc_receipt_voucher"]),
    originalPdcId: z.string().uuid("Select the original cheque"),
    returnDate: z.string().date("Enter a valid date"),
    returnReason: z.string().min(1, "Required"),
    penaltyAmount: z.coerce.number().nonnegative(),
    penaltyAccountId: z.string().uuid().optional().or(z.literal("")),
  })
  .refine((d) => d.penaltyAmount === 0 || !!d.penaltyAccountId, {
    message: "Select a penalty account",
    path: ["penaltyAccountId"],
  });

export type ChequeReturnVoucherInput = z.output<typeof chequeReturnVoucherSchema>;
export type ChequeReturnVoucherFormValues = z.input<typeof chequeReturnVoucherSchema>;
