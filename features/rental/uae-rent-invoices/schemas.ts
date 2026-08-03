import { z } from "zod";

export const recordPaymentSchema = z.object({
  paymentDate: z.string().date("Enter a valid date"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  cashBankAccountId: z.string().uuid("Select the cash/bank account"),
});

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;
export type RecordPaymentFormValues = z.input<typeof recordPaymentSchema>;
