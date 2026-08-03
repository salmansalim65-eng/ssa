import { z } from "zod";

export const openingBalanceVoucherSchema = z
  .object({
    asOfDate: z.string().date("Enter a valid date"),
    accountId: z.string().uuid("Select the account"),
    contraAccountId: z.string().uuid("Select the contra account (e.g. Opening Balance Equity)"),
    currencyId: z.string().uuid("Select a currency"),
    debitAmount: z.coerce.number().nonnegative(),
    creditAmount: z.coerce.number().nonnegative(),
  })
  .refine((d) => d.accountId !== d.contraAccountId, {
    message: "Account and contra account must differ",
    path: ["contraAccountId"],
  })
  .refine((d) => (d.debitAmount > 0) !== (d.creditAmount > 0), {
    message: "Enter either a debit or a credit amount, not both",
    path: ["creditAmount"],
  });

export type OpeningBalanceVoucherInput = z.output<typeof openingBalanceVoucherSchema>;
export type OpeningBalanceVoucherFormValues = z.input<typeof openingBalanceVoucherSchema>;
