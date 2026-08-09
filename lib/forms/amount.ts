// Helpers for monetary amount inputs that should appear BLANK until the user
// enters a value, instead of showing a literal 0.
//
// Safety: the zod schemas coerce an empty submit to 0 (`z.coerce.number()`), and
// every running total uses `Number(x) || 0`, so a blank field can never leak
// NaN/undefined into a calculation. Required amounts still fail their
// `.positive()`/`.min()` rule when left blank, showing a validation message.
//
// Use `blankAmount` in form defaultValues / emptyLine() for amount fields, and
// `amountValue(field.value)` for the input's `value` prop. Do NOT use these for
// exchange rates, currency-conversion factors, counts, or percentages.

/** Default for an un-entered amount field — renders as an empty input. */
export const blankAmount = "" as unknown as number;

/**
 * Show the number when present, otherwise a blank string. Accepts `unknown`
 * because react-hook-form types a field's `value` as `unknown`; a null/undefined
 * (un-entered) value renders as an empty input instead of a literal 0.
 */
export function amountValue(v: unknown): number | string {
  return (v ?? "") as number | string;
}
