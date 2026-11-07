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

export interface RentMonths {
  /** The month the letting's rent is first counted in: the month it STARTED. */
  firstMonth: string;
  /** How many months it covers, at least one. */
  months: number;
  /** Days the letting is longer (+) or shorter (-) than those whole months. */
  stretchDays: number;
  /** True when that difference is big enough that somebody should look. */
  isPartial: boolean;
}

/** The average length of a calendar month, 365.25 / 12. */
const AVG_MONTH_DAYS = 30.4375;

/**
 * Which months a from–to letting's rent belongs to.
 *
 * WHICH month is the month the unit was LET. A unit handed over on 18
 * September is September's rent, whether it runs to 17 October or to 30
 * September — the letting is what happened in September, and no part of it is
 * carried into October because most of its days fall there.
 *
 * HOW MANY months comes from the length, rounded to the nearest whole month.
 * Counting whole months and reporting a remainder instead calls 1 Oct – 29 Nov
 * "one month and twenty-nine days" and bills it once, when it is plainly the
 * two months the lease already invoices.
 *
 * `stretchDays` says how far the real letting is from those whole months, so a
 * twenty-day letting billed as a month can be questioned rather than waved
 * through. A day or two either way is the calendar, not a mistake.
 */
export function rentMonthsFor(from: string, to: string): RentMonths {
  if (!from || !to || to < from) {
    return { firstMonth: monthStart(from || to || "1970-01-01"), months: 1, stretchDays: 0, isPartial: false };
  }
  const firstMonth = monthStart(from);
  // The letting ends the DAY AFTER `to`: 18 Sep – 17 Oct is thirty days.
  const actual = daysBetween(from, addDays(to, 1));
  const months = Math.max(1, Math.round(actual / AVG_MONTH_DAYS));

  const nominal = daysBetween(firstMonth, addMonths(firstMonth, months));
  const stretchDays = actual - nominal;
  return { firstMonth, months, stretchDays, isPartial: Math.abs(stretchDays) > 5 };
}

/**
 * The month a line is counted in on a given statement.
 *
 * The month it was let, but never EARLIER than the month the sheet is for. A
 * letting that began on the 30th or 31st belongs to the month that starts a day
 * or two later, which is the month the agent is billing it on. The first
 * statement SSA ever posted used the same rule to a wider end: the books began
 * in August, so July's lettings were counted there too.
 */
export function rentMonthOn(firstMonth: string, statementMonth: string): string {
  return firstMonth < statementMonth ? statementMonth : firstMonth;
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

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * The month a sheet's own tab is named for: "SEP-26" is September 2026.
 *
 * The agent dates a statement whenever he draws it up — September's came out
 * on 10 October — so the date on the paper is not the month it is FOR. Taking
 * it as such pulled every line of September's sheet forward into October. The
 * tab he typed says which month he meant, so that is what is read.
 *
 * A tab that names a month but no year — "OCT 2", the second sheet for the
 * same month — takes `fallbackYear`, normally the year on the statement date.
 * Without it such a tab reads as no month at all, and October's supplementary
 * sheet, drawn up in November, would come in as November's.
 *
 * Returns null for a tab that names no month ("Sales Tracker Copy 3"), leaving
 * the caller to fall back to the date.
 */
export function monthFromLabel(label: string, fallbackYear?: number): string | null {
  const text = label.toLowerCase();
  const monthIndex = MONTH_NAMES.findIndex((name) => {
    // Three letters is enough to name a month, and no more is required: "sep",
    // "sept" and "september" are the same month, "may" is itself.
    const at = text.indexOf(name.slice(0, 3));
    return at >= 0 && !/[a-z]/.test(text[at - 1] ?? "");
  });
  if (monthIndex < 0) return null;

  const rest = text.replace(MONTH_NAMES[monthIndex].slice(0, 3), "");
  const year = /(?:^|[^0-9])(\d{4}|\d{2})(?:[^0-9]|$)/.exec(rest);
  const n = year ? Number(year[1]) : fallbackYear;
  if (!n) return null;
  const full = n >= 100 ? n : 2000 + n;
  return `${full}-${String(monthIndex + 1).padStart(2, "0")}-01`;
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
