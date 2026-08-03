import { z } from "zod";

export const paymentVoucherSchema = z.object({
  paymentDate: z.string().date("Enter a valid date"),
  paidTo: z.string().min(1, "Required"),
  debitAccountId: z.string().uuid("Select the expense/payable account"),
  creditAccountId: z.string().uuid("Select the cash/bank account"),
  currencyId: z.string().uuid("Select a currency"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  narration: z.string().optional().or(z.literal("")),
});

export type PaymentVoucherInput = z.output<typeof paymentVoucherSchema>;
export type PaymentVoucherFormValues = z.input<typeof paymentVoucherSchema>;
