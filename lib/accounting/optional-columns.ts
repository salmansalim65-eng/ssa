import "server-only";

/**
 * Columns a deployment may be asking for before the database has them.
 *
 * A deploy and a migration do not land together, and a Postgres select that
 * names a column the table has not got fails ENTIRELY — it does not return the
 * other columns. So a new field, still unmigrated, does not degrade to a blank
 * field: it empties the whole screen. That is what happened to Chart of
 * Accounts when the bank-detail columns shipped ahead of their migration.
 *
 * Callers use `isUnknownColumn` to recognise that exact failure and retry
 * without the new columns, so the page keeps working on the old schema and
 * picks the fields up by itself once the migration runs.
 */
export function isUnknownColumn(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  // 42703 is Postgres's undefined_column; PGRST204 is PostgREST failing to find
  // it in its own schema cache, which is the same situation from the app's side.
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the '.*' column/i.test(error.message ?? "");
}

/** Strips keys from a row about to be written, for the same retry. */
export function withoutKeys<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

/** The bank-detail columns added in migration 0141. */
export const BANK_DETAIL_COLUMNS = [
  "bank_name",
  "bank_account_title",
  "bank_account_no",
  "bank_iban",
  "bank_branch",
  "bank_swift",
] as const;
