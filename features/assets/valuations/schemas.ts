import { z } from "zod";

export const valuationSchema = z.object({
  valuationDate: z.string().date("Enter a valid date"),
  marketValue: z.coerce.number().nonnegative("Must be zero or greater"),
  valuer: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export type ValuationInput = z.output<typeof valuationSchema>;
export type ValuationFormValues = z.input<typeof valuationSchema>;
