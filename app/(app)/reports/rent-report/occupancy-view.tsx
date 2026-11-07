import { Fragment } from "react";

import { CsvExportButton } from "@/components/reports/csv-export-button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { loadStatementStays } from "@/lib/rental/statement-rent";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Status colours, not series colours: occupied is "good", vacant is "critical".
// Both clear 3:1 on the light and dark chart surfaces.
const OCCUPIED = "#0ca30c";
const VACANT = "#d03b3b";

const DAY_MS = 86_400_000;
/** A YYYY-MM-DD date as a UTC timestamp, so day arithmetic never drifts with the server's timezone. */
function utcDay(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

interface OccupancyRow {
  id: string;
  code: string;
  name: string;
  /** Occupied days in each calendar month of the year. */
  months: number[];
  occupied: number;
  vacant: number;
}

/**
 * How many days each HH property was let, and how many it stood empty.
 *
 * HH lettings are short stays — a few weeks at a time, several to a property in
 * a year — so what matters is days, not months. Every stay that touches the
 * window is clipped to it and its days marked off on a calendar per property,
 * which counts overlapping or back-to-back stays once rather than adding them
 * up. Both ends of a stay are counted: 1–31 Aug is 31 days.
 *
 * The window is NOT the whole calendar year. It runs from the day the company's
 * books open to today — months before the books existed hold no lettings, and
 * months still to come have not happened, so counting either as vacant would
 * bury a well-let property under empty days it was never offered for. A past
 * year runs to its own year end.
 *
 * The stays come from the agent's STATEMENTS, not from leases. A short-term
 * unit has no lease; its letting is a line on the monthly sheet, and that line
 * carries the two dates the unit was actually let between — better evidence
 * than a lease ever was, because the lease was a monthly abstraction over them.
 * Long-term lines are left out: they restate a letting invoiced from a lease.
 */
export async function OccupancyView({ companyId, year }: { companyId: string; year: number }) {
  const supabase = await createClient();
  const { data: company } = await supabase
    .schema("core")
    .from("companies")
    .select("accounting_period_start")
    .eq("id", companyId)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const booksOpen = (company?.accounting_period_start as string | null) ?? `${year}-01-01`;
  const windowStart = booksOpen > `${year}-01-01` ? booksOpen : `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const windowEnd = today < yearEnd ? today : yearEnd;
  const totalDays =
    windowEnd < windowStart ? 0 : Math.round((utcDay(windowEnd) - utcDay(windowStart)) / DAY_MS) + 1;

  const [stays, { data: costCenters }] = await Promise.all([
    loadStatementStays(companyId),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, code, name, asset_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("code"),
  ]);

  // Every property the statements have ever let belongs in the report — one let
  // for none of this year is simply vacant all year, which is the point.
  const letCentreIds = new Set(stays.map((s) => s.costCenterId));
  const properties =
    totalDays === 0 ? [] : (costCenters ?? []).filter((c) => letCentreIds.has(c.id as string));

  const calendarByCentre = new Map<string, boolean[]>();
  for (const stay of stays) {
    // Clip the stay to the window; one entirely outside it contributes nothing.
    const from = Math.max(utcDay(stay.from), utcDay(windowStart));
    const to = Math.min(utcDay(stay.to), utcDay(windowEnd));
    if (to < from) continue;

    let calendar = calendarByCentre.get(stay.costCenterId);
    if (!calendar) {
      calendar = Array(totalDays).fill(false) as boolean[];
      calendarByCentre.set(stay.costCenterId, calendar);
    }
    for (let t = from; t <= to; t += DAY_MS) {
      calendar[Math.round((t - utcDay(windowStart)) / DAY_MS)] = true;
    }
  }

  // Which month each day of the window belongs to, and how many days of each
  // month the window actually covers — September counts only up to today.
  const monthOfDayIndex: number[] = [];
  const daysInWindowByMonth = Array(12).fill(0) as number[];
  for (let i = 0; i < totalDays; i += 1) {
    const month = new Date(utcDay(windowStart) + i * DAY_MS).getUTCMonth();
    monthOfDayIndex.push(month);
    daysInWindowByMonth[month] += 1;
  }

  const rows: OccupancyRow[] = properties.map((c) => {
    const calendar = calendarByCentre.get(c.id as string);
    const months = Array(12).fill(0) as number[];
    let occupied = 0;
    if (calendar) {
      for (let i = 0; i < totalDays; i += 1) {
        if (!calendar[i]) continue;
        months[monthOfDayIndex[i]] += 1;
        occupied += 1;
      }
    }
    return {
      id: c.id as string,
      code: c.code as string,
      name: c.name as string,
      months,
      occupied,
      vacant: totalDays - occupied,
    };
  });

  const monthTotals = Array(12).fill(0) as number[];
  let occupiedTotal = 0;
  for (const r of rows) {
    r.months.forEach((d, i) => (monthTotals[i] += d));
    occupiedTotal += r.occupied;
  }
  const capacity = rows.length * totalDays;
  // The months the window actually reaches, and the biggest of them — the
  // month chart scales every column against that one so a part month reads as
  // shorter rather than as fully let.
  const coveredMonths = daysInWindowByMonth
    .map((d, m) => (d > 0 ? m : -1))
    .filter((m) => m >= 0);
  const maxMonthCapacity = Math.max(1, ...coveredMonths.map((m) => rows.length * daysInWindowByMonth[m]));
  const maxMonthDays = Math.max(1, ...coveredMonths.map((m) => daysInWindowByMonth[m]));
  const pct = (occupied: number, of: number) => (of > 0 ? `${((occupied / of) * 100).toFixed(1)}%` : "—");

  const dash = "–";
  const thisMonth = year === new Date().getFullYear() ? new Date().getMonth() : -1;

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted-foreground">
          {rows.length} HH {rows.length === 1 ? "property" : "properties"} ·{" "}
          <span className="font-medium text-foreground">
            {formatDate(windowStart)} – {formatDate(windowEnd)}
          </span>{" "}
          ({totalDays} {totalDays === 1 ? "day" : "days"}) ·{" "}
          <span className="font-medium text-foreground">{occupiedTotal.toLocaleString()} occupied</span> ·{" "}
          {(capacity - occupiedTotal).toLocaleString()} vacant · {pct(occupiedTotal, capacity)} occupancy
        </p>
        <CsvExportButton
          filename={`hh-occupancy-${year}.csv`}
          headers={[
            "S.No",
            "Code",
            "Property",
            ...MONTHS,
            `Occupied days (of ${totalDays})`,
            "Vacant days",
            "Occupancy %",
          ]}
          rows={rows.map((r, i) => [
            i + 1,
            r.code,
            r.name,
            ...r.months,
            r.occupied,
            r.vacant,
            pct(r.occupied, totalDays),
          ])}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border bg-card shadow-xs print:overflow-visible">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-primary text-primary-foreground [&>th]:border-r [&>th]:border-primary/40 [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
              <th className="sticky left-0 z-30 w-12 bg-primary text-right">S.No</th>
              <th className="sticky left-12 z-30 min-w-[220px] bg-primary text-left">Property</th>
              {MONTHS.map((m, i) => (
                <th key={m} className={cn("whitespace-nowrap text-right", i === thisMonth && "bg-white/15")}>
                  {m}
                </th>
              ))}
              <th className="whitespace-nowrap text-right">Occupied</th>
              <th className="whitespace-nowrap text-right">Vacant</th>
              <th className="whitespace-nowrap text-right">Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={17} className="py-12 text-center text-muted-foreground">
                  {totalDays === 0
                    ? `The books open on ${formatDate(booksOpen)}, so ${year} has nothing to report.`
                    : "No HH properties yet."}
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const rowBg = i % 2 ? "bg-muted/30" : "bg-card";
              return (
                <tr
                  key={r.id}
                  className={cn("group/row border-b border-border/50 [&>td]:px-3 [&>td]:py-2", rowBg, "hover:bg-primary/[0.05]")}
                >
                  <td className={cn("sticky left-0 z-10 w-12 border-r border-border/50 text-right font-mono text-xs tabular-nums text-muted-foreground", rowBg, "group-hover/row:bg-primary/[0.05]")}>
                    {i + 1}
                  </td>
                  <td className={cn("sticky left-12 z-10 min-w-[220px] border-r border-border/50 font-medium", rowBg, "group-hover/row:bg-primary/[0.05]")}>
                    {r.name}
                  </td>
                  {r.months.map((d, m) => (
                    <td
                      key={m}
                      className={cn(
                        "text-right font-mono tabular-nums",
                        m === thisMonth && "bg-primary/[0.04]",
                        // A month the window does not reach is greyed out, so a
                        // blank there never reads as "let to nobody".
                        daysInWindowByMonth[m] === 0 && "bg-muted/40",
                      )}
                      title={
                        daysInWindowByMonth[m] === 0
                          ? "Outside the reporting window"
                          : `${d} of ${daysInWindowByMonth[m]} days`
                      }
                    >
                      {daysInWindowByMonth[m] === 0 ? (
                        <span className="text-muted-foreground/50">{dash}</span>
                      ) : (
                        d || <span className="text-muted-foreground">{dash}</span>
                      )}
                    </td>
                  ))}
                  <td className="text-right font-mono font-semibold tabular-nums">{r.occupied}</td>
                  <td className="text-right font-mono tabular-nums text-muted-foreground">{r.vacant}</td>
                  <td className="text-right font-mono tabular-nums">{pct(r.occupied, totalDays)}</td>
                </tr>
              );
            })}
            {rows.length > 0 && (
              <tr className="bg-primary font-semibold text-primary-foreground [&>td]:px-3 [&>td]:py-2">
                <td colSpan={2} className="sticky left-0 z-10 bg-primary text-xs uppercase tracking-wide">
                  Total — {rows.length} {rows.length === 1 ? "property" : "properties"} × {totalDays} days
                </td>
                {monthTotals.map((d, m) => (
                  <td
                    key={m}
                    className={cn(
                      "text-right font-mono tabular-nums",
                      m === thisMonth && "bg-white/15",
                      daysInWindowByMonth[m] === 0 && "text-primary-foreground/40",
                    )}
                  >
                    {daysInWindowByMonth[m] === 0 ? dash : d || dash}
                  </td>
                ))}
                <td className="text-right font-mono tabular-nums">{occupiedTotal}</td>
                <td className="text-right font-mono tabular-nums">{capacity - occupiedTotal}</td>
                <td className="text-right font-mono tabular-nums">{pct(occupiedTotal, capacity)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* The year as a grid: a row per property, a column per month, and the
          whole window on the right.

          One bar per property said WHICH property stood empty but never WHEN —
          a property let solidly until October and one let in fits read the same
          at 90 of 95 days. Broken into months, an empty stretch is a gap you can
          point at, in the same month columns the table above uses.

          A month's cell is as WIDE as that month is long, measured against the
          longest, so November's three days are a sliver rather than a full cell
          that reads as a month gone to waste. The cells carry no numbers — the
          table directly above is nothing but those numbers, and repeating them
          at this size would be unreadable; each cell names its own figures on
          hover, and the Total column keeps its count in full. */}
      {rows.length > 0 && coveredMonths.length > 0 && (
        <div className="shrink-0 overflow-x-auto rounded-xl border bg-card p-4 shadow-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Days of {year} let, by property
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: OCCUPIED }} aria-hidden />
                Occupied
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: VACANT }} aria-hidden />
                Vacant
              </span>
            </div>
          </div>
          <div
            className="grid min-w-[700px] items-center gap-x-2 gap-y-1.5"
            style={{
              gridTemplateColumns: `11rem repeat(${coveredMonths.length}, minmax(0, 1fr)) minmax(0, 1.6fr) 7rem`,
            }}
          >
            <span aria-hidden />
            {coveredMonths.map((m) => (
              <span
                key={`head-${m}`}
                className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {MONTHS[m]}
              </span>
            ))}
            <span className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              Total
            </span>
            <span aria-hidden />

            {[...rows]
              .sort((a, b) => b.occupied - a.occupied)
              .map((r) => (
                <Fragment key={r.id}>
                  <span className="truncate text-xs text-muted-foreground" title={r.name}>
                    {r.name}
                  </span>
                  {coveredMonths.map((m) => {
                    const monthDays = daysInWindowByMonth[m];
                    const occupied = r.months[m];
                    const vacant = monthDays - occupied;
                    return (
                      <div key={m} className="flex h-5 items-center justify-center">
                        <div
                          className="flex h-full overflow-hidden rounded-sm"
                          // As wide as the month is long, against the longest
                          // month: three days of November is a sliver.
                          style={{ width: `${(monthDays / maxMonthDays) * 100}%` }}
                          title={`${r.name} — ${MONTHS[m]}: ${occupied} let, ${vacant} vacant of ${monthDays} days`}
                        >
                          <div
                            style={{
                              width: `${(occupied / monthDays) * 100}%`,
                              backgroundColor: OCCUPIED,
                              // 1px, not 2 — at this size 2 eats the shorter fill.
                              marginRight: occupied > 0 && vacant > 0 ? 1 : 0,
                            }}
                          />
                          <div className="flex-1" style={{ backgroundColor: VACANT }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex h-5 overflow-hidden rounded-sm">
                    <div
                      className="flex items-center justify-end pr-1.5 text-[0.65rem] font-semibold tabular-nums text-white"
                      style={{
                        width: `${(r.occupied / totalDays) * 100}%`,
                        backgroundColor: OCCUPIED,
                        marginRight: r.occupied > 0 && r.vacant > 0 ? 2 : 0,
                      }}
                      title={`${r.name} — occupied ${r.occupied} of ${totalDays} days`}
                    >
                      {(r.occupied / totalDays) * 100 >= 18 ? r.occupied : ""}
                    </div>
                    <div
                      className="flex flex-1 items-center justify-end pr-1.5 text-[0.65rem] font-semibold tabular-nums text-white"
                      style={{ backgroundColor: VACANT }}
                      title={`${r.name} — vacant ${r.vacant} of ${totalDays} days`}
                    >
                      {r.vacant > 0 ? r.vacant : ""}
                    </div>
                  </div>
                  <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {r.occupied}/{totalDays} · {pct(r.occupied, totalDays)}
                  </span>
                </Fragment>
              ))}
          </div>
        </div>
      )}

      {/* The same year read the other way round: a column per month, headed by
          its month, so the chart's months line up with the table's and a bad
          month shows up as a shape rather than as a number somebody has to
          compare by eye across the total row.

          A column is as TALL as that month's capacity — every property, every
          day of the month the window covers — measured against the fullest
          month. So a part month like the first or the current one is a short
          column rather than a full one that reads as badly let.

          The columns are a fixed width rather than stretched to fill the row:
          seven properties over four months would otherwise give squat blocks
          the eye reads as bars of their own.

          Only the months the window reaches are drawn. Drawing January to July
          as empty, in a year whose books open in August, would read as seven
          months nobody let the properties for. */}
      {rows.length > 0 && coveredMonths.length > 0 && (
        <div className="shrink-0 rounded-xl border bg-card p-4 shadow-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Days of {year} let, by month
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: OCCUPIED }} aria-hidden />
                Occupied
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: VACANT }} aria-hidden />
                Vacant
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 sm:gap-4">
            {coveredMonths.map((m) => {
              const monthCapacity = rows.length * daysInWindowByMonth[m];
              const occupied = monthTotals[m];
              const vacant = monthCapacity - occupied;
              const columnPct = (monthCapacity / maxMonthCapacity) * 100;
              const occupiedPct = monthCapacity > 0 ? (occupied / monthCapacity) * 100 : 0;
              const label = `${MONTHS[m]} — ${rows.length} ${
                rows.length === 1 ? "property" : "properties"
              } × ${daysInWindowByMonth[m]} days`;
              return (
                <div key={m} className="flex w-16 shrink-0 flex-col items-center gap-1">
                  <span className="text-xs font-semibold text-foreground">{MONTHS[m]}</span>
                  <span className="text-[0.65rem] tabular-nums text-muted-foreground">
                    {pct(occupied, monthCapacity)}
                  </span>
                  <div className="flex h-44 w-full items-end">
                    <div
                      className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                      style={{ height: `${columnPct}%` }}
                      title={`${label} — ${occupied} of ${monthCapacity} days let`}
                    >
                      <div
                        className="flex items-start justify-center pt-0.5 text-[0.65rem] font-semibold tabular-nums text-white"
                        style={{
                          height: `${occupiedPct}%`,
                          backgroundColor: OCCUPIED,
                          // A 2px gap so the two fills read as separate marks.
                          marginTop: occupied > 0 && vacant > 0 ? 2 : 0,
                        }}
                      >
                        {occupiedPct >= 14 ? occupied : ""}
                      </div>
                      <div
                        className="flex flex-1 items-start justify-center pt-0.5 text-[0.65rem] font-semibold tabular-nums text-white"
                        style={{ backgroundColor: VACANT }}
                      >
                        {vacant > 0 && 100 - occupiedPct >= 14 ? vacant : ""}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                    {occupied}/{monthCapacity}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </>
  );
}
