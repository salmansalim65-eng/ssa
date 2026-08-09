import { z } from "zod";

// One JV-maintenance line: cost centre + debit account + credit account +
// amount, plus its own billing period (from / till) and remarks.
export const jvMaintenanceLineSchema = z.object({
  costCenterId: z.string().uuid().optional().or(z.literal("")),
  debitAccountId: z.string().uuid("Select the debit account"),
  creditAccountId: z.string().uuid("Select the credit account"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  periodFrom: z.string().date("Enter a valid date").optional().or(z.literal("")),
  periodTill: z.string().date("Enter a valid date").optional().or(z.literal("")),
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
});

export const jvMaintenanceVoucherSchema = z.object({
  entryDate: z.string().date("Enter a valid date"),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z.array(jvMaintenanceLineSchema).min(1, "Add at least one line"),
});

export type JvMaintenanceLineInput = z.output<typeof jvMaintenanceLineSchema>;
export type JvMaintenanceVoucherInput = z.output<typeof jvMaintenanceVoucherSchema>;
export type JvMaintenanceVoucherFormValues = z.input<typeof jvMaintenanceVoucherSchema>;
