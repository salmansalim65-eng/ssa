/**
 * Recognising a table the database has not got yet.
 *
 * Same lesson as `lib/accounting/optional-columns.ts`: a deploy and a
 * migration do not land together, and a select against a missing table fails
 * entirely. Notes ship with migration 0142, so until that is run the section
 * says what to run rather than taking the page down with it.
 */
export const NOTES_MIGRATION = "0142_my_dashboard_notes.sql";

export function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  // 42P01 is Postgres's undefined_table; PGRST205 is PostgREST not finding it
  // in its schema cache, which is the same situation from the app's side.
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}
