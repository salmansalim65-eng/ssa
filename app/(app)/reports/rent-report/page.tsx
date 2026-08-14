import { Fragment, Suspense } from "react";

import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { ReportNav } from "@/components/reports/report-nav";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Cost-centre country → display label + the country's own currency code.
const COUNTRY: Record<string, { label: string; code: string }> = {
  AE: { label: "United Arab Emirates", code: "AED" },
  PK: { label: "Pakistan", code: "PKR" },
  SA: { label: "Saudi Arabia", code: "SAR" },
};

interface CcRow {
  id: string;
  code: string;
  name: string;
  country: string;
  est: number;
  months: number[]; // 12 entries — rent billed per calendar month
  total: number;
}

export default async function RentReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const currentYear = new Date().getFullYear();
  const { year: yearParam = "" } = await searchParams;
  const year = Number(yearParam) || currentYear;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: costCenters }, { data: pkLeases }, { data: uaeLeases }, { data: currencies }] =
    await Promise.all([
      supabase
        .schema("accounting")
        .from("cost_centers")
        .select("id, code, name, country, asset_id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("code"),
      supabase
        .schema("rental")
        .from("pk_leases")
        .select("asset_id, monthly_rent, lease_start, lease_end")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .schema("rental")
        .from("uae_leases")
        .select("asset_id, rental_amount, rent_cycle, lease_start, lease_end")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase.schema("core").from("currencies").select("code, symbol"),
    ]);

  const symbolByCode = new Map((currencies ?? []).map((c) => [c.code as string, c.symbol as string]));

  // Active lease per asset: monthly rent + period, so a monthly lease shows its
  // monthly rent in EVERY month it covers (not a lump where its invoice posted).
  interface AssetLease {
    monthly: number;
    start: string | null;
    end: string | null;
  }
  const leaseByAsset = new Map<string, AssetLease>();
  for (const l of pkLeases ?? []) {
    if (!l.asset_id) continue;
    leaseByAsset.set(l.asset_id as string, {
      monthly: Number(l.monthly_rent) || 0,
      start: (l.lease_start as string) ?? null,
      end: (l.lease_end as string) ?? null,
    });
  }
  for (const l of uaeLeases ?? []) {
    if (!l.asset_id) continue;
    const monthly = l.rent_cycle === "yearly" ? Number(l.rental_amount) / 12 : Number(l.rental_amount) || 0;
    leaseByAsset.set(l.asset_id as string, {
      monthly,
      start: (l.lease_start as string) ?? null,
      end: (l.lease_end as string) ?? null,
    });
  }

  // Month boundaries for the selected year (YYYY-MM-DD, safe for string compare).
  const monthStart = (m: number) => `${year}-${String(m + 1).padStart(2, "0")}-01`;
  const monthEnd = (m: number) => `${year}-${String(m + 1).padStart(2, "0")}-${String(new Date(year, m + 1, 0).getDate())}`;

  // One accumulator per cost centre, spreading the lease monthly across the
  // months of the year it is active.
  const rows = new Map<string, CcRow>();
  for (const cc of costCenters ?? []) {
    const lease = cc.asset_id ? leaseByAsset.get(cc.asset_id as string) : undefined;
    const months = Array(12).fill(0) as number[];
    let total = 0;
    if (lease && lease.monthly > 0) {
      for (let m = 0; m < 12; m++) {
        const active = (!lease.start || lease.start <= monthEnd(m)) && (!lease.end || lease.end >= monthStart(m));
        if (active) {
          months[m] = lease.monthly;
          total += lease.monthly;
        }
      }
    }
    rows.set(cc.id as string, {
      id: cc.id as string,
      code: cc.code as string,
      name: cc.name as string,
      country: (cc.country as string) ?? "",
      est: lease?.monthly ?? 0,
      months,
      total,
    });
  }

  // Group cost centres by country, keeping only rows with an estimate or any
  // billed rent so the report doesn't fill with empty properties.
  const byCountry = new Map<string, CcRow[]>();
  for (const row of rows.values()) {
    if (row.est === 0 && row.total === 0) continue;
    const list = byCountry.get(row.country) ?? [];
    list.push(row);
    byCountry.set(row.country, list);
  }
  // Sections: UAE and PK first (as requested), then any other country present.
  const order = ["AE", "PK", ...[...byCountry.keys()].filter((c) => c !== "AE" && c !== "PK")];
  const sections = order.filter((c) => byCountry.has(c)).map((c) => ({ country: c, rows: byCountry.get(c)! }));

  const yearOptions = [1, 2, 3, 4].map((n) => ({ value: String(currentYear - n), label: String(currentYear - n) }));

  const exportRows = sections.flatMap((s) =>
    s.rows.map((r) => [
      COUNTRY[s.country]?.label ?? s.country,
      r.code,
      r.name,
      r.est,
      ...r.months,
      r.total,
    ]),
  );

  const dash = "—";
  const thisMonth = year === currentYear ? new Date().getMonth() : -1;
  const totalCols = 15; // cost centre + est + 12 months + total

  return (
    <div className="space-y-5">
      <ReportNav className="print:hidden" />
      <PageHeader
        eyebrow="Reports"
        title="Rent Report"
        description={`Cost-centre-wise, month-wise rent for ${year} — each active lease's monthly rent shown across the months it covers. UAE and Pakistan shown separately, each in its own currency.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`rent-report-${year}.csv`}
              headers={["Country", "Code", "Cost centre", "Est. Rent", ...MONTHS, "Total"]}
              rows={exportRows}
            />
            <PrintButton />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Suspense>
          <ReportSelectFilter
            label="Year"
            param="year"
            allLabel={String(currentYear)}
            options={yearOptions}
            selected={yearParam}
            width="w-40"
          />
        </Suspense>
      </div>

      {/* Per-country annual-rent summary */}
      {sections.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map((s) => {
            const cur = COUNTRY[s.country]?.code ?? "";
            const symbol = symbolByCode.get(cur) ?? cur;
            const total = s.rows.reduce((a, r) => a + r.total, 0);
            return (
              <Kpi
                key={s.country}
                label={`${COUNTRY[s.country]?.label ?? s.country} — Annual Rent`}
                value={`${symbol ? symbol + " " : ""}${formatMoney(total)}`}
                sub={`${s.rows.length} propert${s.rows.length === 1 ? "y" : "ies"} · ${cur}`}
              />
            );
          })}
        </div>
      )}

      {/* Month-wise rent matrix */}
      <div className="max-h-[72vh] overflow-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-header text-header-foreground [&>th]:border-r [&>th]:border-header-border [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
              <th className="sticky left-0 z-30 min-w-[240px] bg-header text-left">Cost centre</th>
              <th className="whitespace-nowrap text-right">Est. Rent</th>
              {MONTHS.map((m, i) => (
                <th key={m} className={cn("whitespace-nowrap text-right", i === thisMonth && "bg-white/10")}>
                  {m}
                </th>
              ))}
              <th className="whitespace-nowrap text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {sections.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="py-12 text-center text-muted-foreground">
                  No active leases for {year}.
                </td>
              </tr>
            )}
            {sections.map((section) => {
              const cur = COUNTRY[section.country]?.code ?? "";
              const symbol = symbolByCode.get(cur) ?? cur;
              const label = COUNTRY[section.country]?.label ?? section.country;
              const money = (n: number) => (n ? `${symbol ? symbol + " " : ""}${formatMoney(n)}` : "");
              const secEst = section.rows.reduce((s, r) => s + r.est, 0);
              const secMonths = MONTHS.map((_, i) => section.rows.reduce((s, r) => s + r.months[i], 0));
              const secTotal = section.rows.reduce((s, r) => s + r.total, 0);
              return (
                <Fragment key={section.country}>
                  {/* Country band */}
                  <tr className="bg-ledger-dark text-white">
                    <td colSpan={totalCols} className="sticky left-0 bg-ledger-dark px-3 py-2 text-xs font-bold uppercase tracking-wide">
                      {label}
                      {symbol ? ` · ${cur}` : ""}
                    </td>
                  </tr>
                  {/* Property rows */}
                  {section.rows.map((r, ri) => {
                    const rowBg = ri % 2 ? "bg-muted/30" : "bg-card";
                    return (
                      <tr key={r.id} className={cn("group/row border-b border-border/50 [&>td]:px-3 [&>td]:py-2", rowBg, "hover:bg-primary/[0.05]")}>
                        <td className={cn("sticky left-0 z-10 min-w-[240px] border-r border-border/50", rowBg, "group-hover/row:bg-primary/[0.05]")}>
                          <span className="mr-2 font-mono text-[0.7rem] text-muted-foreground">{r.code}</span>
                          <span className="font-medium text-foreground">{r.name}</span>
                        </td>
                        <td className="text-right font-mono tabular-nums text-muted-foreground">{r.est ? money(r.est) : dash}</td>
                        {r.months.map((v, i) => (
                          <td
                            key={i}
                            className={cn(
                              "text-right font-mono tabular-nums",
                              i === thisMonth && "bg-primary/[0.04]",
                              !v && "text-muted-foreground/40",
                            )}
                          >
                            {v ? money(v) : dash}
                          </td>
                        ))}
                        <td className="text-right font-mono font-semibold tabular-nums text-foreground">{money(r.total)}</td>
                      </tr>
                    );
                  })}
                  {/* Country total */}
                  <tr className="border-y border-ledger/40 bg-ledger/15 font-semibold text-ledger-dark [&>td]:px-3 [&>td]:py-2">
                    <td className="sticky left-0 z-10 bg-ledger/15 text-xs uppercase tracking-wide">Total — {label}</td>
                    <td className="text-right font-mono tabular-nums">{secEst ? money(secEst) : dash}</td>
                    {secMonths.map((v, i) => (
                      <td key={i} className={cn("text-right font-mono tabular-nums", i === thisMonth && "bg-ledger/10")}>
                        {v ? money(v) : dash}
                      </td>
                    ))}
                    <td className="text-right font-mono tabular-nums">{money(secTotal)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <p className="truncate text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
