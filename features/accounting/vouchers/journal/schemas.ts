import { z } from "zod";

export const journalLineSchema = z
  .object({
    accountId: z.string().uuid("Select an account"),
    costCenterId: z.string().optional().or(z.literal("")),
    debit: z.coerce.number().nonnegative(),
    credit: z.coerce.number().nonnegative(),
    description: z.string().optional().or(z.literal("")),
  })
  .refine((d) => !(d.debit > 0 && d.credit > 0), {
    message: "A line can't be both debit and credit",
    path: ["credit"],
  });

export const journalVoucherSchema = z
  .object({
    entryDate: z.string().date("Enter a valid date"),
    currencyId: z.string().uuid("Select a currency"),
    narration: z.string().min(1, "Required"),
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
