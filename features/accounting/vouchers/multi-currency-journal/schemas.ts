import { z } from "zod";

// One raw journal line: an account posted on ONE side (debit or credit) for an
// amount in its OWN currency, with the conversion rate to the company base
// currency. base = amount × rate, and the whole voucher must balance in base
// (sum of base debits = sum of base credits).
export const multiCurrencyJournalLineSchema = z.object({
  costCenterId: z.string().uuid("Select a cost center").optional().or(z.literal("")),
  accountId: z.string().uuid("Select the account"),
  side: z.enum(["debit", "credit"]),
  currencyId: z.string().uuid("Select a currency"),
  exchangeRate: z.coerce.number().positive("Currency conversion is required"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export const multiCurrencyJournalSchema = z
  .object({
    entryDate: z.string().date("Enter a valid date"),
    narration: z.string().trim().max(500, "Keep it under 500 characters").optional().or(z.literal("")),
    lines: z.array(multiCurrencyJournalLineSchema).min(2, "Add at least one debit and one credit line"),
  })
  .refine(
    (v) => {
      const baseDebit = v.lines
        .filter((l) => l.side === "debit")
        .reduce((s, l) => s + round2(l.amount * l.exchangeRate), 0);
      const baseCredit = v.lines
        .filter((l) => l.side === "credit")
        .reduce((s, l) => s + round2(l.amount * l.exchangeRate), 0);
      return baseDebit > 0 && Math.abs(baseDebit - baseCredit) < 0.01;
    },
    {
      message: "Debit and credit must balance in the base currency",
      path: ["lines"],
    },
  );

export type MultiCurrencyJournalLineInput = z.output<typeof multiCurrencyJournalLineSchema>;
export type MultiCurrencyJournalInput = z.output<typeof multiCurrencyJournalSchema>;
export type MultiCurrencyJournalFormValues = z.input<typeof multiCurrencyJournalSchema>;
