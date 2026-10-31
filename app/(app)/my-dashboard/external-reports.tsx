import { Suspense } from "react";

import { formatMoney } from "@/lib/format";
import { configuredExternalApps, fetchExternalSummaries } from "@/lib/my-dashboard/external-summary";

/**
 * The other systems' headline figures, as cards beside SSA's own.
 *
 * Streamed, because these are HTTP calls to someone else's app: the rest of My
 * Dashboard must not wait on MBL's response time, and a neighbour that is down
 * must cost a card, not the page.
 *
 * Nothing renders until an app is configured. A row of empty placeholders for
 * systems nobody connected is clutter; the setup it needs is in
 * `docs/07-my-dashboard-external-summary.md`, not on everyone's dashboard.
 */
export function ExternalReports() {
  if (configuredExternalApps().length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Other systems</h2>
      <Suspense fallback={<Skeleton count={configuredExternalApps().length} />}>
        <Cards />
      </Suspense>
    </section>
  );
}

function Skeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-lg border bg-card" />
      ))}
    </div>
  );
}

async function Cards() {
  const summaries = await fetchExternalSummaries();

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {summaries.map((s) => (
        <div key={s.key} className="rounded-lg border bg-card p-4 shadow-xs">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{s.label}</p>
            {s.asOf && <p className="text-xs text-muted-foreground">{s.asOf}</p>}
          </div>

          {s.error ? (
            <p className="mt-2 text-sm text-muted-foreground">{s.error}</p>
          ) : s.figures.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No figures published yet.</p>
          ) : (
            <dl className="mt-2 space-y-1">
              {s.figures.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-3">
                  <dt className="truncate text-sm text-muted-foreground">{f.label}</dt>
                  <dd className="shrink-0 text-base font-semibold tabular-nums text-foreground">
                    {f.currency ? `${f.currency} ${formatMoney(f.amount)}` : formatMoney(f.amount)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}
