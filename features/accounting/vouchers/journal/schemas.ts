import { z } from "zod";

// A bill adjustment on a journal line: apply this amount to a rental invoice.
// `direction` says which way the invoice's outstanding moves — 'increase' when
// the tenant is on the debit side (billing), 'decrease' when on the credit side
// (collection). The form derives it from the invoice's tenant account.
export const journalAllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  country: z.enum(["UAE", "PK"]),
  amount: z.coerce.number().positive(),
  direction: z.enum(["increase", "decrease"]),
});

// One journal line = a cost centre + a debit account + a credit account + an
// amount. The row is inherently balanced; it expands into a debit line and a
// credit line at post time. Optional bill adjustments move a rental invoice's
// outstanding balance up (billing) or down (collection).
export const journalLineSchema = z.object({
  costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
  debitAccountId: z.string().uuid("Select the debit account"),
  creditAccountId: z.string().uuid("Select the credit account"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  allocations: z.array(journalAllocationSchema).optional().default([]),
});

export const journalVoucherSchema = z.object({
  entryDate: z.string().date("Enter a valid date"),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
  lines: z.array(journalLineSchema).min(1, "Add at least one line"),
});

export type JournalVoucherInput = z.output<typeof journalVoucherSchema>;
export type JournalVoucherFormValues = z.input<typeof journalVoucherSchema>;
export type JournalLineInput = z.output<typeof journalLineSchema>;
export type JournalAllocationInput = z.output<typeof journalAllocationSchema>;
