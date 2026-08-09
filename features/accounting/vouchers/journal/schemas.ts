import { z } from "zod";

// One journal grid line: an account (with optional cost centre) carrying a
// Debit or a Credit, plus a Reference and Remarks.
export const journalLineSchema = z
  .object({
    accountId: z.string().uuid("Select an account"),
    costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
    debit: z.coerce.number().nonnegative(),
    credit: z.coerce.number().nonnegative(),
    reference: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
    remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
  })
  .refine((d) => !(d.debit > 0 && d.credit > 0), {
    message: "A line can't be both debit and credit",
    path: ["credit"],
  });

// Shared header + grid schema for the Journal Voucher and (identically) the JV
// Maintenance Voucher.
export const journalVoucherSchema = z
  .object({
    entryDate: z.string().date("Enter a valid date"),
    currencyId: z.string().uuid("Select a currency"),
    exchangeRate: z.coerce.number().positive("Currency conversion is required"),
    narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
    lines: z.array(journalLineSchema).min(2, "At least two lines are required"),
  })
  .refine(
    (d) => {
      const totalDebit = d.lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = d.lines.reduce((sum, l) => sum + l.credit, 0);
      return Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;
    },
    { message: "Debit and credit totals must match and be greater than zero", path: ["lines"] },
  );

export type JournalVoucherInput = z.output<typeof journalVoucherSchema>;
export type JournalVoucherFormValues = z.input<typeof journalVoucherSchema>;
export type JournalLineInput = z.output<typeof journalLineSchema>;
