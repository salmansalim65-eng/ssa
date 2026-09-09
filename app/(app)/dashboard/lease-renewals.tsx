import { AlertTriangleIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DUE_SOON_DAYS, daysBetween, loadLeaseRenewals, type LeaseRenewal } from "@/lib/rental/renewals";

// Status colours, not series colours: an ended contract is critical, one inside
// its last month needs attention, the rest are fine. Red and green are the
// hardest pair for a colour-blind reader, so no bar carries its meaning in
// colour alone — every row states its own status in words and days as well.
const COLOUR: Record<LeaseRenewal["status"], string> = {
  overdue: "#d03b3b",
  due: "#a05c00",
  later: "#0ca30c",
};

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

function statusText(r: LeaseRenewal): string {
  if (r.status === "overdue") {
    const late = -r.daysLeft;
    return `Overdue ${late} ${late === 1 ? "day" : "days"}`;
  }
  if (r.daysLeft === 0) return "Renewal due today";
  return `Due in ${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"}`;
}

/**
 * Contract renewals, as a timeline.
 *
 * One bar per running lease, drawn from today to the day its contract ends, so
 * the shortest bar is the next renewal to deal with. A contract that has already
 * ended is drawn on the other side of the today line, in red, as far back as it
 * is late — it reads as time lost rather than time left.
 *
 * The banner above the chart is the alert: it counts the contracts that have
 * reached or passed their renewal date, and is what the header bell mirrors on
 * every other screen.
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

  // Month boundaries across the visible window, for the axis above the bars.
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
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contract renewals</p>
          <p className="text-sm text-muted-foreground">
            {rows.length} running {rows.length === 1 ? "contract" : "contracts"} — when each one ends and is due for
            renewal
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: COLOUR.overdue }} aria-hidden />
            Overdue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: COLOUR.due }} aria-hidden />
            Due within {DUE_SOON_DAYS} days
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: COLOUR.later }} aria-hidden />
            Later
          </span>
        </div>
      </div>

      {/* The alert itself: what has reached its renewal date, named so it can be
          acted on without reading the chart. */}
      {(overdue.length > 0 || due.length > 0) && (
        <div
          className={cn(
            "mb-4 flex items-start gap-2.5 rounded-lg border p-3 text-sm",
            overdue.length > 0
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
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
                .map((r) => `${r.property} (${statusText(r).toLowerCase()})`)
                .join(" · ")}
              {overdue.length + due.length > 6 && ` · +${overdue.length + due.length - 6} more`}
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Month axis. The today line is repeated on every bar row below so a
              bar is always read against it. */}
          <div className="flex items-end gap-3 pb-1">
            <span className="w-44 shrink-0" />
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
            <span className="w-56 shrink-0" />
          </div>

          <div className="space-y-1.5">
            {rows.map((r) => {
              const endPct = positionPct(r.daysLeft);
              const left = Math.min(TODAY_PCT, endPct);
              // A bar that would round away to nothing (a contract ending today)
              // still gets a sliver, so every row has a visible mark.
              const width = Math.max(Math.abs(endPct - TODAY_PCT), 0.6);
              return (
                <div key={r.key} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate text-xs text-muted-foreground" title={`${r.property} — ${r.tenant}`}>
                    {r.property}
                  </span>
                  <div className="relative h-5 flex-1 rounded-sm bg-muted/60">
                    {/* Today */}
                    <span
                      className="absolute top-0 h-full w-px bg-foreground/40"
                      style={{ left: `${TODAY_PCT}%` }}
                      aria-hidden
                    />
                    <span
                      className="absolute top-0.5 h-4 rounded-sm"
                      style={{ left: `${left}%`, width: `${width}%`, backgroundColor: COLOUR[r.status] }}
                      title={`${r.property} — contract ends ${formatDate(r.end)} (${statusText(r)})`}
                    />
                  </div>
                  <span className="w-56 shrink-0 text-right text-xs">
                    <span className="font-mono tabular-nums text-muted-foreground">{formatDate(r.end)}</span>
                    <span
                      className={cn(
                        "ml-2 font-medium",
                        r.status === "overdue" && "text-destructive",
                        r.status === "due" && "text-amber-700 dark:text-amber-400",
                        r.status === "later" && "text-muted-foreground",
                      )}
                    >
                      {statusText(r)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
              <th className="text-left">Property</th>
              <th className="text-left">Tenant</th>
              <th className="text-left">Segment</th>
              <th className="text-right">Contract ends</th>
              <th className="text-right">Renewal</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0 [&>td]:px-2 [&>td]:py-1.5">
                <td className="font-medium">{r.property}</td>
                <td className="text-muted-foreground">{r.tenant}</td>
                <td className="text-muted-foreground">{r.segment}</td>
                <td className="text-right font-mono tabular-nums">{formatDate(r.end)}</td>
                <td className="text-right text-muted-foreground">{r.renewLabel}</td>
                <td
                  className={cn(
                    "text-right font-medium",
                    r.status === "overdue" && "text-destructive",
                    r.status === "due" && "text-amber-700 dark:text-amber-400",
                    r.status === "later" && "text-muted-foreground",
                  )}
                >
                  {statusText(r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
