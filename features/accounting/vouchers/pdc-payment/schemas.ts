import { z } from "zod";

export const pdcPaymentVoucherSchema = z.object({
  chequeDate: z.string().date("Enter a valid date"),
  chequeNo: z.string().min(1, "Required"),
  payee: z.string().min(1, "Required"),
  debitAccountId: z.string().uuid("Select the expense/payable account"),
  creditAccountId: z.string().uuid("Select the PDC liability account"),
  currencyId: z.string().uuid("Select a currency"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  narration: z.string().optional().or(z.literal("")),
});

export type PdcPaymentVoucherInput = z.output<typeof pdcPaymentVoucherSchema>;
export type PdcPaymentVoucherFormValues = z.input<typeof pdcPaymentVoucherSchema>;
