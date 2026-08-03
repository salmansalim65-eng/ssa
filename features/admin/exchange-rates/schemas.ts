import { z } from "zod";

export const exchangeRateSchema = z.object({
  currencyId: z.string().uuid("Select a currency"),
  rateDate: z.string().date("Enter a valid date"),
  rateToBase: z.coerce.number().positive("Rate must be greater than zero"),
});

export type ExchangeRateInput = z.output<typeof exchangeRateSchema>;
export type ExchangeRateFormValues = z.input<typeof exchangeRateSchema>;
