import { z } from "zod";

export const addCurrencySchema = z.object({
  code: z
    .string()
    .length(3, "Use a 3-letter ISO 4217 code")
    .regex(/^[A-Z]{3}$/, "Uppercase letters only, e.g. PKR"),
  name: z.string().min(2, "Name is required"),
  symbol: z.string().min(1, "Symbol is required").max(5),
  decimalPlaces: z.coerce.number().int().min(0).max(6),
});

// z.output: what the server action receives after parsing (decimalPlaces: number).
export type AddCurrencyInput = z.output<typeof addCurrencySchema>;
// z.input: what the form actually holds before coercion — pass this as
// useForm's TFieldValues generic so defaultValues/field types line up with
// the coerced field, per @hookform/resolvers' zod v4 + coerce guidance.
export type AddCurrencyFormValues = z.input<typeof addCurrencySchema>;
