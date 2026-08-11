// When rent counts as overdue.
//
// Rent is *Due* from its due date and stays Due through the end of the due
// date's calendar month. It only becomes *Overdue* once that month has ended —
// i.e. on the first day of the following month. Example: a due date of
// 20-08-2026 shows as Due through 31-08-2026 and flips to Overdue on
// 01-09-2026.
//
// Pure and calendar-only (no time zones): both arguments are ISO date strings
// (`YYYY-MM-DD`, or any ISO timestamp whose date prefix is used). The SQL view
// `reporting.v_outstanding_rent` mirrors this rule so screens and reports agree.

/**
 * First day of the month AFTER the given date's month, as `YYYY-MM-01`.
 * This is the threshold at or after which rent is overdue.
 */
export function overdueThreshold(dueDate: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(dueDate);
  if (!match) return dueDate;
  const year = Number(match[1]);
  const month = Number(match[2]); // 1-12
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}

/**
 * True when rent with the given `dueDate` is overdue as of `asOf` — that is,
 * once the due date's month has ended. Both are ISO date strings; ISO dates
 * compare correctly as plain strings.
 */
export function isRentOverdue(dueDate: string, asOf: string): boolean {
  if (!dueDate) return false;
  return asOf >= overdueThreshold(dueDate);
}
