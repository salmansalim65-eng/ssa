/**
 * Which month a letting's rent belongs to, and how many months it covers.
 *
 * SSA counts rent by the MONTH, not by the day. The month a letting starts in
 * is the month its rent is: 15 Nov – 15 Dec is November's rent, and the next
 * letting of the same unit, 16 Dec – 16 Jan, is December's. A letting that runs
 * two months is two rent months, starting at the first.
 *
 * Nothing here is apportioned by day, on purpose. The agent's statement, the
 * books and the conversation with the agent all speak in months; a figure
 * spread across days would agree with none of them.
 *
 * Pure: no database, no dates from the environment. Everything is an ISO
 * YYYY-MM-DD string in and out, so the month a letting falls in never depends
 * on the server's timezone.
 */

/** The first of the month a date falls in, as YYYY-MM-DD. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** `n` months after a month start. */
export function addMonths(monthStartDate: string, n: number): string {
  const year = Number(monthStartDate.slice(0, 4));
  const month = Number(monthStartDate.slice(5, 7)) - 1 + n;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Where a letting's nth month ends, as the first day NOT in it.
 *
 * Normally the same day of the month, n months on: a letting from the 18th
 * runs to the 17th, so its boundary is the 18th. Where that day does not exist
 * — a letting from the 31st of January has no 31st of February to end before —
 * the month ends with the short month itself, and the boundary is the 1st of
 * the month after. Without that, every letting starting after the 28th would
 * report a day or three left over that nobody let anything for.
 */
function monthBoundary(from: string, n: number): string {
  const [y, m, d] = from.split("-").map(Number);
  const total = m - 1 + n;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (d > lastDay) {
    // Clamped: the month ran to the end of a short month, so the next one
    // starts on the 1st.
    const next = new Date(Date.UTC(year, month + 1, 1));
    return next.toISOString().slice(0, 10);
  }
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface RentPeriod {
  /** Whole months the period covers, counted from its start. */
  months: number;
  /** Days left over after those whole months — 0 when it divides exactly. */
  remainderDays: number;
  /** True when the period is not a whole number of months, so somebody should look. */
  isPartial: boolean;
}

/**
 * How many rent months a from–to period is.
 *
 * Counted by the calendar, not by dividing days: 18 Jul – 17 Sep is two
 * months because 18 Aug falls inside it, whatever the two months happen to be
 * worth in days. Both ends are the agent's, so 28 Jul – 27 Aug is one month
 * rather than one month less a day.
 *
 * A period that is NOT a whole number of months — 01 Aug – 21 Sep is one month
 * and twenty-one days — reports the remainder rather than rounding it away.
 * Rounding it silently is how a month's rent lands in the wrong month and
 * nobody finds out; the screen asks instead.
 */
export function rentPeriod(from: string, to: string): RentPeriod {
  if (!from || !to || to < from) return { months: 1, remainderDays: 0, isPartial: false };

  let months = 0;
  // The letting ends the DAY AFTER `to`, so a month runs from the 18th to the
  // 17th: 18 Jul + 1 month = 18 Aug, which is inside 18 Jul – 17 Sep.
  const endExclusive = addDays(to, 1);
  while (monthBoundary(from, months + 1) <= endExclusive) months += 1;

  if (months === 0) return { months: 1, remainderDays: 0, isPartial: true };

  const covered = monthBoundary(from, months);
  const remainderDays = daysBetween(covered, endExclusive);
  return { months, remainderDays, isPartial: remainderDays > 0 };
}

/** The rent months a line covers: its first, then one per month after it. */
export function rentMonthsOf(firstMonth: string, months: number): string[] {
  return Array.from({ length: Math.max(1, months) }, (_, i) => addMonths(monthStart(firstMonth), i));
}

/**
 * How a line's rent divides across its months.
 *
 * Evenly, to two decimals, with the LAST month taking whatever the rounding
 * left over — so the parts always add back to the whole. 7,167 over two months
 * is 3,583.50 and 3,583.50; 100 over three is 33.33, 33.33 and 33.34.
 */
export function splitOverMonths(amount: number, months: number): number[] {
  const n = Math.max(1, months);
  const each = Math.round((amount / n) * 100) / 100;
  const parts = Array(n).fill(each) as number[];
  parts[n - 1] = Math.round((amount - each * (n - 1)) * 100) / 100;
  return parts;
}

/** "Aug 2026" — how a rent month reads on screen. */
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function rentMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  return m ? `${MONTH_ABBR[Number(m[2]) - 1]} ${m[1]}` : "";
}

/* ------------------------------------------------------------------ dates */

const DAY_MS = 86_400_000;
function utc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}
function addDays(date: string, n: number): string {
  return new Date(utc(date) + n * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}
