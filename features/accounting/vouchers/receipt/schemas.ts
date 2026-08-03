import { z } from "zod";

export const receiptVoucherSchema = z.object({
  receiptDate: z.string().date("Enter a valid date"),
  receivedFrom: z.string().min(1, "Required"),
  debitAccountId: z.string().uuid("Select the cash/bank account"),
  creditAccountId: z.string().uuid("Select the contra account"),
  currencyId: z.string().uuid("Select a currency"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  narration: z.string().optional().or(z.literal("")),
});

export type ReceiptVoucherInput = z.output<typeof receiptVoucherSchema>;
export type ReceiptVoucherFormValues = z.input<typeof receiptVoucherSchema>;
