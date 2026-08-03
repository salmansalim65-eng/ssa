import { z } from "zod";

export const utilityChargeSchema = z.object({
  utilityType: z.enum(["electricity", "gas", "water", "other"], { message: "Select a utility type" }),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  description: z.string().optional().or(z.literal("")),
});

export const generatePkInvoiceFormSchema = z.object({
  utilityCharges: z.array(utilityChargeSchema).default([]),
  advanceAdjusted: z.coerce.number().nonnegative().default(0),
});

export const generatePkInvoiceSchema = generatePkInvoiceFormSchema.and(z.object({ scheduleId: z.string().uuid() }));

export type UtilityChargeInput = z.output<typeof utilityChargeSchema>;
export type GeneratePkInvoiceInput = z.output<typeof generatePkInvoiceSchema>;
export type GeneratePkInvoiceFormInput = z.output<typeof generatePkInvoiceFormSchema>;
export type GeneratePkInvoiceFormValues = z.input<typeof generatePkInvoiceFormSchema>;

export const recordPkPaymentSchema = z.object({
  paymentDate: z.string().date("Enter a valid date"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  cashBankAccountId: z.string().uuid("Select the cash/bank account"),
});

export type RecordPkPaymentInput = z.output<typeof recordPkPaymentSchema>;
export type RecordPkPaymentFormValues = z.input<typeof recordPkPaymentSchema>;
