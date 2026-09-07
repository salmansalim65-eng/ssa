import { CsvExportButton } from "@/components/reports/csv-export-button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

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
 * Only HH leases are read, so a property let on a standard UAE lease does not
 * appear here at all.
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

  const [{ data: leases }, { data: costCenters }] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("asset_id, lease_start, lease_end")
      .eq("company_id", companyId)
      .eq("lease_type", "hh")
      .is("deleted_at", null),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, code, name, asset_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("code"),
  ]);

  // Every property that has ever taken an HH letting belongs in the report — one
  // that took none this year is simply vacant all year, which is the point.
  const hhAssetIds = new Set((leases ?? []).map((l) => l.asset_id as string).filter(Boolean));
  const properties =
    totalDays === 0
      ? []
      : (costCenters ?? []).filter((c) => c.asset_id && hhAssetIds.has(c.asset_id as string));

  const calendarByAsset = new Map<string, boolean[]>();
  for (const l of leases ?? []) {
    const assetId = l.asset_id as string;
    const start = (l.lease_start as string | null) ?? null;
    const end = (l.lease_end as string | null) ?? null;
    if (!assetId || !start || !end) continue;
    // Clip the stay to the window; one entirely outside it contributes nothing.
    const from = Math.max(utcDay(start), utcDay(windowStart));
    const to = Math.min(utcDay(end), utcDay(windowEnd));
    if (to < from) continue;

    let calendar = calendarByAsset.get(assetId);
    if (!calendar) {
      calendar = Array(totalDays).fill(false) as boolean[];
      calendarByAsset.set(assetId, calendar);
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
    const calendar = calendarByAsset.get(c.asset_id as string);
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

      {/* The year as one bar per property: how much of it was let, how much
          stood empty. Green and red alone are the hardest pair for a colour-blind
          reader — deutan separation measures well under the safe floor — so every
          segment carries its own day count and the legend names both. The colour
          is the quick read; the numbers are the meaning. */}
      {rows.length > 0 && (
        <div className="shrink-0 rounded-xl border bg-card p-4 shadow-xs">
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
          <div className="space-y-1.5">
            {[...rows]
              .sort((a, b) => b.occupied - a.occupied)
              .map((r) => {
                const occupiedPct = (r.occupied / totalDays) * 100;
                return (
                  <div key={r.id} className="flex items-center gap-3">
                    <span className="w-44 shrink-0 truncate text-xs text-muted-foreground" title={r.name}>
                      {r.name}
                    </span>
                    <div className="flex h-5 flex-1 overflow-hidden rounded-sm">
                      <div
                        className="flex items-center justify-end pr-1.5 text-[0.65rem] font-semibold tabular-nums text-white"
                        style={{
                          width: `${occupiedPct}%`,
                          backgroundColor: OCCUPIED,
                          // A 2px gap so the two fills read as separate marks.
                          marginRight: r.occupied > 0 && r.vacant > 0 ? 2 : 0,
                        }}
                        title={`${r.name} — occupied ${r.occupied} of ${totalDays} days`}
                      >
                        {occupiedPct >= 12 ? r.occupied : ""}
                      </div>
                      <div
                        className="flex flex-1 items-center justify-end pr-1.5 text-[0.65rem] font-semibold tabular-nums text-white"
                        style={{ backgroundColor: VACANT }}
                        title={`${r.name} — vacant ${r.vacant} of ${totalDays} days`}
                      >
                        {r.vacant > 0 ? r.vacant : ""}
                      </div>
                    </div>
                    <span className="w-28 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {r.occupied}/{totalDays} · {pct(r.occupied, totalDays)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

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
    </>
  );
}
