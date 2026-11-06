import { z } from "zod";

/**
 * The agent's monthly sheet, as a form.
 *
 * Every money field is what the SHEET says, never what a rate would make it.
 * The agent rounds — 7,167 at 10% is 717 on their paper — and a form that
 * recomputed it would disagree with the statement it exists to match.
 */
const money = z.coerce.number().min(0, "Cannot be negative");

export const rentStatementLineSchema = z.object({
  lineType: z.enum(["short_term", "long_term"]),
  costCenterId: z.string().uuid("Pick the unit"),
  periodFrom: z.string().min(1, "From date is required"),
  periodTo: z.string().min(1, "To date is required"),
  /** The first month this line's rent belongs to, stored as its first day. */
  rentMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the rent month"),
  months: z.coerce.number().int().min(1, "At least one month").max(24, "At most 24 months"),
  rentAmount: money,
  managementAmount: money,
  dewa: money,
  internet: money,
  accessCard: money,
  wifi: money,
  other: money,
  remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
});

export const rentStatementSchema = z
  .object({
    statementDate: z.string().min(1, "Statement date is required"),
    /** The month the sheet is headed with, stored as its first day. */
    statementMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the month"),
    agentAccountId: z.string().uuid("Pick the agent's account"),
    currencyId: z.string().uuid("Pick a currency"),
    exchangeRate: z.coerce.number().positive("Rate must be greater than zero"),
    narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
    lines: z.array(rentStatementLineSchema).min(1, "Add at least one line"),
    /**
     * What the sheet's own GRAND TOTAL says. Optional, and checked against the
     * lines when given: the single most useful guard there is, because a
     * mistyped line shows up as a total that does not match rather than as a
     * number that merely looks plausible.
     */
    sheetTotalNet: z.union([money, z.literal("")]).optional(),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((l, i) => {
      if (l.periodTo && l.periodFrom && l.periodTo < l.periodFrom) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "periodTo"],
          message: "To cannot be before From",
        });
      }
      const deductions = l.dewa + l.internet + l.accessCard + l.wifi + l.other;
      if (l.managementAmount + deductions > l.rentAmount + 0.005 && l.lineType === "long_term") {
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "managementAmount"],
          message: "Deductions come to more than the rent",
        });
      }
    });

    if (typeof v.sheetTotalNet === "number") {
      const net = v.lines.reduce(
        (sum, l) =>
          sum + l.rentAmount - l.managementAmount - (l.dewa + l.internet + l.accessCard + l.wifi + l.other),
        0,
      );
      if (Math.abs(Math.round((net - v.sheetTotalNet) * 100) / 100) >= 0.005) {
        ctx.addIssue({
          code: "custom",
          path: ["sheetTotalNet"],
          message: `The lines come to ${net.toFixed(2)} — the sheet says ${v.sheetTotalNet.toFixed(2)}`,
        });
      }
    }
  });

export type RentStatementInput = z.output<typeof rentStatementSchema>;
export type RentStatementFormValues = z.input<typeof rentStatementSchema>;
export type RentStatementLineInput = z.output<typeof rentStatementLineSchema>;

/** The default management rate each kind of line is offered. */
export const MANAGEMENT_RATE: Record<"short_term" | "long_term", number> = {
  short_term: 0.1,
  long_term: 0.05,
};
