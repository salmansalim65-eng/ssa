import { z } from "zod";

export const pdcReceiptVoucherSchema = z.object({
  chequeDate: z.string().date("Enter a valid date"),
  chequeNo: z.string().min(1, "Required"),
  payer: z.string().min(1, "Required"),
  debitAccountId: z.string().uuid("Select the PDC asset account"),
  creditAccountId: z.string().uuid("Select the income/receivable account"),
  currencyId: z.string().uuid("Select a currency"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  narration: z.string().optional().or(z.literal("")),
});

export type PdcReceiptVoucherInput = z.output<typeof pdcReceiptVoucherSchema>;
export type PdcReceiptVoucherFormValues = z.input<typeof pdcReceiptVoucherSchema>;
