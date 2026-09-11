// A rental month runs from a day to the day BEFORE the same day next month, so
// 3 Aug 2026 → 2 Sep 2026 is exactly ONE month (not two). Counting by calendar
// month index would wrongly call that two months and bill/show it in both
// August and September.
//
// billingMonthStarts returns the start date (YYYY-MM-DD) of every rental month
// the period [start, end] covers: begin at `start` and step one month at a time
// while the anniversary date is still within the period. ISO date strings are
// zero-padded, so plain string comparison orders them correctly.
export function billingMonthStarts(start: string, end: string): string[] {
  const sp = start.split("-").map(Number);
  const sy = sp[0];
  const sm = sp[1];
  const sd = sp[2];
  if (!sy || !sm || !sd) return [start];

  const out: string[] = [];
  let y = sy;
  let m = sm; // 1-based month
  let guard = 0;
  while (guard++ < 600) {
    // Clamp the anniversary day to the month's length (e.g. a 31st start in a
    // 30-day month falls on the 30th).
    const daysInMonth = new Date(y, m, 0).getDate();
    const d = Math.min(sd, daysInMonth);
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso > end) break;
    out.push(iso);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.length ? out : [start];
}

// Number of whole rental months the period covers (3 Aug → 2 Sep = 1).
export function billingMonthCount(start: string, end: string): number {
  return billingMonthStarts(start, end).length;
}

/**
 * Split a combined voucher's rental months into the instalments they fall due
 * in, per the property's payment terms.
 *
 * Each instalment falls due at the FIRST month of its block but PAYS FOR every
 * month in it: an advance covering Aug–Mar is due in August and is rent for all
 * eight. `count` is how many months the block covers, `lastMonth` the final one.
 *
 * advance = one block (the whole period); monthly = one-month blocks;
 * quarterly / half_yearly / yearly = 3 / 6 / 12-month blocks.
 *
 * This is the rule the Rent Balance report groups by AND the rule the receipt
 * adjustment dialog offers bills by, so a receipt settling "what is overdue"
 * lands on exactly the months the report calls overdue. They drifted apart once
 * and a receipt silently prepaid a future month.
 */
export function rentDueChunks(
  months: string[],
  terms: string | null | undefined,
): { dueMonth: string; lastMonth: string; count: number }[] {
  const n = months.length;
  if (n === 0) return [];
  const size =
    terms === "advance"
      ? n
      : terms === "quarterly"
        ? 3
        : terms === "half_yearly"
          ? 6
          : terms === "yearly"
            ? 12
            : 1; // monthly (default)
  const step = Math.max(1, size);
  const chunks: { dueMonth: string; lastMonth: string; count: number }[] = [];
  for (let i = 0; i < n; i += step) {
    const count = Math.min(step, n - i);
    chunks.push({ dueMonth: months[i], lastMonth: months[i + count - 1], count });
  }
  return chunks;
}
