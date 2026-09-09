import {
  AlertTriangleIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  DoorOpenIcon,
  FileTextIcon,
} from "lucide-react";

import { KpiCard } from "@/components/dashboard/kpi-card";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  COUNTRY_LABEL,
  DUE_SOON_DAYS,
  daysBetween,
  loadLeaseRenewals,
  vacantToday,
  type LeaseRenewal,
  type RenewalCountry,
} from "@/lib/rental/renewals";

// Status colours, not series colours: an ended contract is critical, one inside
// its last month needs attention, the rest are fine. Red and green are the
// hardest pair for a colour-blind reader, so no bar carries its meaning in
// colour alone — every row states its status in words and days as well.
const COLOUR: Record<LeaseRenewal["status"], string> = {
  overdue: "#d03b3b",
  due: "#eab308",
  later: "#0ca30c",
  // Nothing running, so nothing to draw — the track stays empty and the row
  // says so in words instead.
  vacant: "transparent",
};

/** A darker rim for the yellow bar, which is otherwise too light to read. */
const COLOUR_EDGE_DUE = "#8a6a00";

// How much time the track shows: three months behind so an expired contract has
// somewhere to be drawn, a year ahead so the next renewal season is visible.
const PAST_DAYS = 90;
const FUTURE_DAYS = 365;
const SPAN_DAYS = PAST_DAYS + FUTURE_DAYS;
const TODAY_PCT = (PAST_DAYS / SPAN_DAYS) * 100;

/** Where a day sits on the track, clipped to its ends. */
function positionPct(daysFromToday: number): number {
  const clipped = Math.max(-PAST_DAYS, Math.min(FUTURE_DAYS, daysFromToday));
  return ((clipped + PAST_DAYS) / SPAN_DAYS) * 100;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The countries a section is drawn for, in the order they are shown. */
const COUNTRIES: RenewalCountry[] = ["AE", "PK"];

// Within a country, holiday homes are listed apart from ordinary leases: an HH
// stay renews every few weeks and a standard lease every year, so mixing them
// in one list says nothing useful about either. They remain UAE lettings — this
// is a kind of contract, not a country.
const SEGMENT_ORDER: LeaseRenewal["segment"][] = ["HH", "UAE", "PK"];
const SEGMENT_LABEL: Record<LeaseRenewal["segment"], string> = {
  HH: "HH — holiday homes",
  UAE: "UAE — standard lease",
  PK: "Standard lease",
};
/** The same distinction inside a table cell, where the heading already said it. */
const SEGMENT_SHORT: Record<LeaseRenewal["segment"], string> = { HH: "HH", UAE: "UAE", PK: "PK" };

function statusText(r: LeaseRenewal): string {
  if (r.daysLeft === null) return "Vacant — no contract";
  if (r.status === "overdue") {
    const late = -r.daysLeft;
    // A contract that has run out means the property is standing empty, so the
    // row says both rather than leaving the vacancy to be inferred.
    return `Overdue ${late} ${late === 1 ? "day" : "days"} · vacant`;
  }
  if (r.daysLeft === 0) return "Renewal due today";
  return `Due in ${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"}`;
}

/** Colour for a status wherever it is written rather than drawn. */
function statusClass(status: LeaseRenewal["status"], overdueOnly = false): string {
  if (status === "overdue") return "text-destructive";
  if (overdueOnly) return "";
  return status === "due" ? "text-yellow-700 dark:text-yellow-400" : "text-muted-foreground";
}

/**
 * Contract renewals, by country.
 *
 * One bar per PROPERTY — not per contract — drawn from today to the day its last
 * running contract ends, so a property let on back-to-back periods is one row
 * and falls due only when the last of them expires. The bar runs from today, so
 * the shortest bar is the next renewal to deal with. A contract that has already
 * ended is drawn on the other side of the today line, in red, as far back as it
 * is late — it reads as time lost rather than time left. An overdue property's
 * NAME is red too, in the chart and in the table, so it is found by eye without
 * following a bar across.
 *
 * UAE and Pakistan get a section each with their own KPIs and their own chart —
 * they are run as separate books — and HH sits inside the UAE, since a holiday
 * home is a UAE letting and not a country of its own.
 *
 * The banner above is the alert: it counts the contracts that have reached or
 * passed their renewal date, and is what the header bell mirrors on every other
 * screen.
 */
export async function LeaseRenewals({ companyId }: { companyId: string }) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const rows = await loadLeaseRenewals(supabase, companyId, today);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contract renewals</p>
        <p className="pt-2 text-sm text-muted-foreground">No active lease carries an end date yet.</p>
      </div>
    );
  }

  const overdue = rows.filter((r) => r.status === "overdue");
  const due = rows.filter((r) => r.status === "due");
  // Standing empty today: the contract ran out, or there never was one.
  const empty = vacantToday(rows);
  // The soonest contract still ahead of us — what to line up next.
  const next = rows.find((r) => r.status === "due" || r.status === "later");

  // Month boundaries across the visible window, for the axis above the bars.
  // The same window serves every country section, so the two charts compare.
  const ticks: { pct: number; label: string }[] = [];
  const first = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1));
  first.setUTCMonth(first.getUTCMonth() - Math.floor(PAST_DAYS / 30));
  for (let i = 0; i < 20; i += 1) {
    const d = new Date(first);
    d.setUTCMonth(first.getUTCMonth() + i);
    const iso = d.toISOString().slice(0, 10);
    const offset = daysBetween(today, iso);
    if (offset < -PAST_DAYS) continue;
    if (offset > FUTURE_DAYS) break;
    ticks.push({
      pct: positionPct(offset),
      label: d.getUTCMonth() === 0 ? `${MONTHS[0]} ${d.getUTCFullYear()}` : MONTHS[d.getUTCMonth()],
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contract renewals</p>
          <p className="text-sm text-muted-foreground">
            When each let property&rsquo;s contract ends, and when it is due for renewal
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: COLOUR.overdue }} aria-hidden />
            Overdue
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: COLOUR.due, boxShadow: `inset 0 0 0 1px ${COLOUR_EDGE_DUE}` }}
              aria-hidden
            />
            Due within {DUE_SOON_DAYS} days
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: COLOUR.later }} aria-hidden />
            Later
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-dashed border-muted-foreground/60" aria-hidden />
            Vacant (no bar)
          </span>
        </div>
      </div>

      {/* The headline numbers, before any chart is read. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Properties on lease"
          value={rows.length.toLocaleString()}
          subtext={COUNTRIES.map((c) => `${COUNTRY_LABEL[c]} ${rows.filter((r) => r.country === c).length}`).join(" · ")}
          icon={FileTextIcon}
        />
        <KpiCard
          label="Renewal overdue"
          value={overdue.length.toLocaleString()}
          subtext={
            overdue.length > 0
              ? `Longest ${-(overdue[0].daysLeft ?? 0)} days — ${overdue[0].property}`
              : "Every contract is inside its term"
          }
          icon={AlertTriangleIcon}
          tone={overdue.length > 0 ? "destructive" : "success"}
        />
        <KpiCard
          label={`Due within ${DUE_SOON_DAYS} days`}
          value={due.length.toLocaleString()}
          subtext={due.length > 0 ? due.map((r) => r.property).slice(0, 2).join(" · ") : "Nothing falling due this month"}
          icon={CalendarClockIcon}
          tone={due.length > 0 ? "warning" : undefined}
        />
        <KpiCard
          label="Empty today"
          value={empty.length.toLocaleString()}
          subtext={
            empty.length > 0
              ? empty.map((r) => r.property).slice(0, 2).join(" · ")
              : "Every property is let"
          }
          icon={DoorOpenIcon}
          tone={empty.length > 0 ? "destructive" : "success"}
        />
        <KpiCard
          label="Next renewal"
          value={next ? formatDate(next.end) : "—"}
          subtext={next ? `${next.property} — ${statusText(next).toLowerCase()}` : "No contract still inside its term"}
          icon={CalendarCheckIcon}
        />
      </div>

      {/* The alert itself: what has reached its renewal date, named so it can be
          acted on without reading the chart. */}
      {(overdue.length > 0 || due.length > 0) && (
        <div
          className={cn(
            "flex items-start gap-2.5 rounded-lg border p-3 text-sm",
            overdue.length > 0
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
          )}
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">
              {overdue.length > 0 && `${overdue.length} contract${overdue.length === 1 ? "" : "s"} past renewal`}
              {overdue.length > 0 && due.length > 0 && " · "}
              {due.length > 0 && `${due.length} due within ${DUE_SOON_DAYS} days`}
            </p>
            <p className="text-xs opacity-90">
              {[...overdue, ...due]
                .slice(0, 6)
                .map((r) => `${r.property} (${COUNTRY_LABEL[r.country]}, ${statusText(r).toLowerCase()})`)
                .join(" · ")}
              {overdue.length + due.length > 6 && ` · +${overdue.length + due.length - 6} more`}
            </p>
          </div>
        </div>
      )}

      {COUNTRIES.map((country) => {
        const countryRows = rows.filter((r) => r.country === country);
        if (countryRows.length === 0) return null;
        const countryOverdue = countryRows.filter((r) => r.status === "overdue").length;
        const countryDue = countryRows.filter((r) => r.status === "due").length;
        const countryEmpty = vacantToday(countryRows).length;
        // Within a country, each kind of letting is listed on its own: an HH
        // stay and a standard lease renew on completely different rhythms, so
        // reading them in one list tells you nothing about either.
        // A vacant property has no kind of letting to file it under, so it is
        // listed on its own at the foot of the country rather than sitting in a
        // lease group with an empty row.
        const letRows = countryRows.filter((r) => r.status !== "vacant");
        const vacantRows = countryRows.filter((r) => r.status === "vacant");
        const segments = SEGMENT_ORDER.filter((seg) => letRows.some((r) => r.segment === seg));

        return (
          <div key={country} className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{COUNTRY_LABEL[country]}</h3>
              <p className="text-xs text-muted-foreground">
                {countryRows.length} {countryRows.length === 1 ? "property" : "properties"} ·{" "}
                <span className={cn(countryOverdue > 0 && "font-semibold text-destructive")}>
                  {countryOverdue} overdue
                </span>{" "}
                ·{" "}
                <span className={cn(countryEmpty > 0 && "font-semibold text-destructive")}>{countryEmpty} empty</span>{" "}
                ·{" "}
                <span className={cn(countryDue > 0 && "font-semibold text-yellow-700 dark:text-yellow-400")}>
                  {countryDue} due soon
                </span>
              </p>
            </div>

            <div className="space-y-5">
              {segments.map((segment) => (
                <RenewalGroup
                  key={segment}
                  title={SEGMENT_LABEL[segment]}
                  // Only worth naming the kind of letting when the country has
                  // more than one; Pakistan has only the standard lease.
                  showTitle={segments.length > 1}
                  rows={letRows.filter((r) => r.segment === segment)}
                  ticks={ticks}
                />
              ))}
              {vacantRows.length > 0 && (
                <RenewalGroup title="Vacant — no contract" showTitle rows={vacantRows} ticks={ticks} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One kind of letting within a country: its bars and its table. Property, end
 * date and time left read together on the left; the timeline is the last column,
 * there for the shape rather than the figure.
 */
function RenewalGroup({
  title,
  showTitle,
  rows,
  ticks,
}: {
  title: string;
  showTitle: boolean;
  rows: LeaseRenewal[];
  ticks: { pct: number; label: string }[];
}) {
  const overdue = rows.filter((r) => r.status === "overdue").length;
  const due = rows.filter((r) => r.status === "due").length;

  return (
    <div>
      {showTitle && (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "property" : "properties"}
            {overdue > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-destructive">{overdue} overdue</span>
              </>
            )}
            {due > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-yellow-700 dark:text-yellow-400">{due} due soon</span>
              </>
            )}
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Month axis over the chart column. The today line is repeated on
              every bar row below, so a bar is always read against it. */}
          <div className="flex items-end gap-3 pb-1">
            <span className="w-44 shrink-0" />
            <span className="w-56 shrink-0" />
            <div className="relative h-4 flex-1">
              {ticks.map((t) => (
                <span
                  key={t.label + t.pct}
                  className="absolute -translate-x-1/2 text-[0.65rem] text-muted-foreground"
                  style={{ left: `${t.pct}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            {rows.map((r) => {
              // A vacant property has no contract to draw, so its track is left
              // empty; everything else runs from today to its end date.
              const endPct = positionPct(r.daysLeft ?? 0);
              const left = Math.min(TODAY_PCT, endPct);
              // A bar that would round away to nothing (a contract ending today)
              // still gets a sliver, so every row has a visible mark.
              const width = Math.max(Math.abs(endPct - TODAY_PCT), 0.6);
              return (
                <div key={r.key} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-44 shrink-0 truncate text-xs",
                      // An overdue property is named in red, so it is found
                      // without tracing its bar.
                      r.status === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground",
                    )}
                    title={`${r.property} — ${r.tenant}${r.contracts > 1 ? ` (${r.contracts} contracts)` : ""}`}
                  >
                    {r.property}
                  </span>
                  <span className="w-56 shrink-0 text-xs">
                    {r.end !== null && (
                      <span
                        className={cn(
                          "font-mono tabular-nums",
                          r.status === "overdue" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {formatDate(r.end)}
                      </span>
                    )}
                    <span className={cn(r.end !== null && "ml-2", "font-medium", statusClass(r.status))}>
                      {statusText(r)}
                    </span>
                  </span>
                  <div className="relative h-5 flex-1 rounded-sm bg-muted/60">
                    {/* Today */}
                    <span
                      className="absolute top-0 h-full w-px bg-foreground/40"
                      style={{ left: `${TODAY_PCT}%` }}
                      aria-hidden
                    />
                    {r.end !== null && (
                      <span
                        className="absolute top-0.5 h-4 rounded-sm"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          backgroundColor: COLOUR[r.status],
                          // Yellow is too light to hold its own against the
                          // track, so the due bar keeps a darker edge.
                          boxShadow: r.status === "due" ? `inset 0 0 0 1px ${COLOUR_EDGE_DUE}` : undefined,
                        }}
                        title={`${r.property} — contract ends ${formatDate(r.end)} (${statusText(r)})`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
              <th className="text-left">Property</th>
              <th className="text-left">Tenant</th>
              <th className="text-left">Type</th>
              <th className="text-right">Contract ends</th>
              <th className="text-right">Renewal</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0 [&>td]:px-2 [&>td]:py-1.5">
                <td className={cn("font-medium", r.status === "overdue" && "text-destructive")}>{r.property}</td>
                <td className="text-muted-foreground">{r.tenant}</td>
                <td className="text-muted-foreground">
                  {r.status === "vacant" ? "—" : SEGMENT_SHORT[r.segment]}
                  {/* A property let on several running contracts is one row,
                      ending with the last of them — say so rather than quietly
                      dropping the others. */}
                  {r.contracts > 1 && <span className="ml-1 text-xs">· {r.contracts} contracts</span>}
                </td>
                <td className={cn("text-right font-mono tabular-nums", r.status === "overdue" && "text-destructive")}>
                  {r.end !== null ? formatDate(r.end) : "—"}
                </td>
                <td className="text-right text-muted-foreground">{r.renewLabel || "—"}</td>
                <td className={cn("text-right font-medium", statusClass(r.status))}>{statusText(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
