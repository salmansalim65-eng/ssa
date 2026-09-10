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
  // An empty stretch between tenancies: drawn, but plainly not a let.
  vacant: "#8a8f98",
};

/** A darker rim for the yellow bar, which is otherwise too light to read. */
const COLOUR_EDGE_DUE = "#8a6a00";

// How much time the track shows: three months behind so an expired contract has
// somewhere to be drawn, a year ahead so the next renewal season is visible.
const PAST_DAYS = 90;
const FUTURE_DAYS = 365;
const SPAN_DAYS = PAST_DAYS + FUTURE_DAYS;
const TODAY_PCT = (PAST_DAYS / SPAN_DAYS) * 100;

/**
 * The stretch a row's bar covers, in days either side of today: the vacancy
 * itself when the property is empty — so "vacant from this date to that" is
 * drawn, not only written — and today-to-expiry when it is let. A property
 * never let has nothing to draw.
 */
function barSpan(r: LeaseRenewal, today: string): { from: number; to: number } | null {
  if (r.isVacant) {
    if (!r.vacantFrom && !r.vacantTo) return null;
    return {
      from: r.vacantFrom ? daysBetween(today, r.vacantFrom) : 0,
      to: daysBetween(today, r.vacantTo ?? today),
    };
  }
  if (r.daysLeft === null) return null;
  // An overdue contract runs BACKWARDS from today to the day it lapsed, so the
  // ends are ordered rather than assumed.
  return { from: Math.min(0, r.daysLeft), to: Math.max(0, r.daysLeft) };
}

/** Where a day sits on the track, clipped to its ends. */
function positionPct(daysFromToday: number): number {
  const clipped = Math.max(-PAST_DAYS, Math.min(FUTURE_DAYS, daysFromToday));
  return ((clipped + PAST_DAYS) / SPAN_DAYS) * 100;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The countries a section is drawn for, in the order they are shown. */
const COUNTRIES: RenewalCountry[] = ["AE", "PK"];

// Inside a country the list is marked off by the TERMS a property is let on,
// not by where it is: an HH stay renews every few weeks and a standard lease
// every year. HH is a UAE letting like any other — the heading separates the
// terms, the country section still holds them all.
const SEGMENT_ORDER: LeaseRenewal["segment"][] = ["HH", "UAE", "PK"];
const SEGMENT_LABEL: Record<LeaseRenewal["segment"], string> = {
  HH: "HH terms — holiday homes",
  UAE: "Standard lease terms",
  PK: "Standard lease terms",
};
/** The same distinction inside a table cell, where the heading already said it. */
const SEGMENT_SHORT: Record<LeaseRenewal["segment"], string> = { HH: "HH", UAE: "UAE", PK: "PK" };

function statusText(r: LeaseRenewal): string {
  if (r.status === "overdue") {
    const late = -(r.daysLeft ?? 0);
    // Only that the renewal is late. Whether the property is actually empty is
    // something an invoice has to say, not something a lapsed date can imply.
    return `Overdue ${late} ${late === 1 ? "day" : "days"}`;
  }
  if (r.isVacant) {
    if (r.vacantTo) return `Vacant until ${formatDate(r.vacantTo)}`;
    if (r.vacantFrom) return `Vacant since ${formatDate(r.vacantFrom)}`;
    return "Never let";
  }
  // Signed but not begun — not let today, and not claimed to be empty either.
  if (r.notStartedYet && r.start) return `Starts ${formatDate(r.start)}`;
  if (r.daysLeft === 0) return "Renewal due today";
  return `Due in ${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"}`;
}

/**
 * The vacancy as a period — from the first empty day to the last, or to today
 * while it is still running. This is where "vacant" is actually stated: a
 * property is only known to be empty once the dates say so.
 */
function vacancyText(r: LeaseRenewal): string {
  if (!r.isVacant) return "—";
  if (!r.vacantFrom && !r.vacantTo) return "Never let";
  const days = r.vacantDays ?? 0;
  const count = `${days} ${days === 1 ? "day" : "days"}`;
  const from = r.vacantFrom ? formatDate(r.vacantFrom) : "—";
  const to = r.vacantTo ? formatDate(r.vacantTo) : "today";
  return `${from} → ${to} · ${count}`;
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
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: COLOUR.vacant }} aria-hidden />
            Vacant stretch
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
          label="Vacant today"
          value={empty.length.toLocaleString()}
          subtext={
            empty.length > 0
              ? empty.map((r) => r.property).slice(0, 2).join(" · ")
              : "None marked vacant"
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

        // A country is ONE list, read top to bottom and numbered straight
        // through. What separates HH from a standard lease is the TERMS, not the
        // country, so the terms get a heading inside the list rather than a
        // chart of their own: they are the same book and belong on the same
        // axis. A vacant property is let on no terms at all, so it closes the
        // list.
        // Only a property that has NEVER been let has no terms to file it
        // under; one that is merely empty between tenancies stays with its own
        // kind of letting, where its gap is visible against the rest.
        const letRows = countryRows.filter((r) => r.contracts > 0);
        const vacantRows = countryRows.filter((r) => r.contracts === 0);
        const blocks: { title: string; rows: LeaseRenewal[] }[] = SEGMENT_ORDER.map((seg) => ({
          title: SEGMENT_LABEL[seg],
          rows: letRows.filter((r) => r.segment === seg),
        })).filter((b) => b.rows.length > 0);
        if (vacantRows.length > 0) blocks.push({ title: "Never let — no contract on record", rows: vacantRows });
        // One running number down the whole country, so a row can be pointed at.
        let serial = 0;
        const numbered = blocks.map((b) => ({
          title: b.title,
          // Only worth naming the kind of letting when there is more than one.
          showTitle: blocks.length > 1,
          rows: b.rows.map((r) => ({ row: r, no: ++serial })),
        }));

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
                <span className={cn(countryEmpty > 0 && "font-semibold text-destructive")}>{countryEmpty} vacant</span>{" "}
                ·{" "}
                <span className={cn(countryDue > 0 && "font-semibold text-yellow-700 dark:text-yellow-400")}>
                  {countryDue} due soon
                </span>
              </p>
            </div>

            <RenewalChart blocks={numbered} ticks={ticks} today={today} />
            <RenewalTable blocks={numbered} />
          </div>
        );
      })}
    </div>
  );
}

/** A property's place in its country's list, with the number it is shown under. */
interface NumberedRow {
  row: LeaseRenewal;
  no: number;
}
interface RenewalBlock {
  title: string;
  showTitle: boolean;
  rows: NumberedRow[];
}

/**
 * The country's timeline: one axis, one bar per property, with a bold heading
 * marking off each kind of letting. Number, property, end date and time left
 * read together on the left; the chart is the last column, there for the shape
 * rather than the figure.
 */
function RenewalChart({
  blocks,
  ticks,
  today,
}: {
  blocks: RenewalBlock[];
  ticks: { pct: number; label: string }[];
  today: string;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        {/* Month axis over the chart column. The today line is repeated on every
            bar row below, so a bar is always read against it. */}
        <div className="flex items-end gap-3 pb-1">
          <span className="w-8 shrink-0" />
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
          {blocks.map((block) => (
            <div key={block.title} className="space-y-1.5">
              {block.showTitle && (
                <p className="border-b pb-0.5 pt-2 text-xs font-bold uppercase tracking-wide text-foreground">
                  {block.title}
                </p>
              )}
              {block.rows.map(({ row: r, no }) => {
                const span = barSpan(r, today);
                const left = span ? positionPct(span.from) : 0;
                // A bar that would round away to nothing (a contract ending
                // today) still gets a sliver, so every row has a visible mark.
                const width = span ? Math.max(positionPct(span.to) - positionPct(span.from), 0.6) : 0;
                return (
                  <div key={r.key} className="flex items-center gap-3">
                    <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {no}
                    </span>
                    <span
                      className={cn(
                        "w-44 shrink-0 truncate text-xs",
                        // An overdue property is named in red, so it is found
                        // without tracing its bar.
                        r.status === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground",
                      )}
                      title={`${r.property} — ${r.tenant}${r.contracts > 1 ? ` (${r.contracts} contracts)` : ""}${
                        r.isVacant ? ` — vacant ${vacancyText(r)}` : ""
                      }`}
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
                      {span && (
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
                          title={
                            r.isVacant
                              ? `${r.property} — vacant ${vacancyText(r)}`
                              : `${r.property} — contract ends ${r.end ? formatDate(r.end) : "—"} (${statusText(r)})`
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The same list as figures, numbered to match the chart row for row. */
function RenewalTable({ blocks }: { blocks: RenewalBlock[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="border-b [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
            <th className="w-10 text-right">S.No</th>
            <th className="text-left">Property</th>
            <th className="text-left">Tenant</th>
            <th className="text-left">Type</th>
            <th className="text-right">Contract ends</th>
            <th className="text-right">Renewal</th>
            <th className="text-right">Vacant period</th>
            <th className="text-right">Status</th>
          </tr>
        </thead>
        {blocks.map((block) => (
          <tbody key={block.title}>
            {block.showTitle && (
              <tr>
                <td
                  colSpan={8}
                  className="border-b bg-muted/50 px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-foreground"
                >
                  {block.title}
                </td>
              </tr>
            )}
            {block.rows.map(({ row: r, no }) => (
              <tr key={r.key} className="border-b [&>td]:px-2 [&>td]:py-1.5">
                <td className="text-right font-mono tabular-nums text-muted-foreground">{no}</td>
                <td className={cn("font-medium", r.status === "overdue" && "text-destructive")}>{r.property}</td>
                <td className="text-muted-foreground">{r.tenant}</td>
                <td className="text-muted-foreground">
                  {r.contracts === 0 ? "—" : SEGMENT_SHORT[r.segment]}
                  {/* A property let on several running contracts is one row,
                      ending with the last of them — say so rather than quietly
                      dropping the others. */}
                  {r.contracts > 1 && <span className="ml-1 text-xs">· {r.contracts} contracts</span>}
                </td>
                <td className={cn("text-right font-mono tabular-nums", r.status === "overdue" && "text-destructive")}>
                  {r.end !== null ? formatDate(r.end) : "—"}
                </td>
                <td className="text-right text-muted-foreground">{r.renewLabel || "—"}</td>
                <td
                  className={cn(
                    "whitespace-nowrap text-right font-mono text-xs tabular-nums",
                    r.isVacant ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {vacancyText(r)}
                </td>
                <td className={cn("text-right font-medium", statusClass(r.status))}>{statusText(r)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
