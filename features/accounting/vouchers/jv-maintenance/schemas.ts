import { z } from "zod";

import { journalLineSchema } from "../journal/schemas";

export const jvMaintenanceVoucherSchema = z
  .object({
    entryDate: z.string().date("Enter a valid date"),
    currencyId: z.string().uuid("Select a currency"),
    originalJvId: z.string().uuid("Select the original JV"),
    adjustmentReason: z.string().min(1, "Required"),
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

export type JvMaintenanceVoucherInput = z.output<typeof jvMaintenanceVoucherSchema>;
export type JvMaintenanceVoucherFormValues = z.input<typeof jvMaintenanceVoucherSchema>;
