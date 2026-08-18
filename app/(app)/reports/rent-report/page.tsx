import { Fragment, Suspense } from "react";

import { cn } from "@/lib/utils";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { ReportNav } from "@/components/reports/report-nav";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { formatAccountCode, formatMoney } from "@/lib/format";
import { HH_AGENT_PCT, UAE_AGENT_PCT } from "@/lib/rental/lease-accounting";

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

  const [
    { data: costCenters },
    { data: pkLeases },
    { data: uaeLeases },
    { data: currencies },
    { data: leaseExpenses },
    { data: rentalAssets },
    { data: companyRow },
  ] = await Promise.all([
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
        .select("id, asset_id, rental_amount, rent_cycle, lease_start, lease_end, lease_type")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase.schema("core").from("currencies").select("code, symbol"),
      supabase.schema("rental").from("lease_expenses").select("lease_id, amount").eq("company_id", companyId),
      supabase
        .schema("assets")
        .from("assets")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_rental", true)
        .is("deleted_at", null),
      supabase.schema("core").from("companies").select("accounting_period_start").eq("id", companyId).maybeSingle(),
    ]);

  const symbolByCode = new Map((currencies ?? []).map((c) => [c.code as string, c.symbol as string]));

  // Monthly HH-lease expense total per lease (feeds the net-rent deduction).
  const expenseByLease = new Map<string, number>();
  for (const e of leaseExpenses ?? []) {
    const k = e.lease_id as string;
    expenseByLease.set(k, (expenseByLease.get(k) ?? 0) + Number(e.amount));
  }

  // Active lease per asset: monthly rent + period, so a monthly lease shows its
  // monthly rent in EVERY month it covers (not a lump where its invoice posted).
  interface AssetLease {
    monthly: number;
    start: string | null;
    end: string | null;
  }
  // A property can carry more than one active lease (e.g. an HH lease and a
  // plain UAE lease on the same unit), so collect ALL of them per asset and sum
  // their net rent — otherwise the later one silently overwrote the earlier.
  const leaseByAsset = new Map<string, AssetLease[]>();
  const addLease = (assetId: string, lease: AssetLease) => {
    const arr = leaseByAsset.get(assetId) ?? [];
    arr.push(lease);
    leaseByAsset.set(assetId, arr);
  };
  for (const l of pkLeases ?? []) {
    if (!l.asset_id) continue;
    addLease(l.asset_id as string, {
      monthly: Number(l.monthly_rent) || 0,
      start: (l.lease_start as string) ?? null,
      end: (l.lease_end as string) ?? null,
    });
  }
  for (const l of uaeLeases ?? []) {
    if (!l.asset_id) continue;
    const gross = l.rent_cycle === "yearly" ? Number(l.rental_amount) / 12 : Number(l.rental_amount) || 0;
    // Net rent = rent − management (agent share: HH 10% / UAE 5%) − HH expenses.
    const isHh = l.lease_type === "hh";
    const management = gross * (isHh ? HH_AGENT_PCT : UAE_AGENT_PCT);
    const expenses = isHh ? expenseByLease.get(l.id as string) ?? 0 : 0;
    const net = Math.max(0, gross - management - expenses);
    addLease(l.asset_id as string, {
      monthly: net,
      start: (l.lease_start as string) ?? null,
      end: (l.lease_end as string) ?? null,
    });
  }

  // Month boundaries for the selected year (YYYY-MM-DD, safe for string compare).
  const monthStart = (m: number) => `${year}-${String(m + 1).padStart(2, "0")}-01`;
  const monthEnd = (m: number) => `${year}-${String(m + 1).padStart(2, "0")}-${String(new Date(year, m + 1, 0).getDate())}`;

  // Accounting-period start: the company setting when set, else the earliest
  // lease start on record. Months entirely before it are left blank (the
  // business didn't exist yet) rather than shown as "Vacant".
  const settingStart = (companyRow?.accounting_period_start as string | null) ?? null;
  const leaseStartDates = [
    ...(pkLeases ?? []).map((l) => l.lease_start as string | null),
    ...(uaeLeases ?? []).map((l) => l.lease_start as string | null),
  ].filter((d): d is string => Boolean(d));
  const periodStart =
    settingStart ?? (leaseStartDates.length ? leaseStartDates.reduce((min, d) => (d < min ? d : min)) : null);

  // One accumulator per cost centre, spreading the lease monthly across the
  // months of the year it is active.
  // Rental properties only (a cost centre linked to a rental asset). Vacant ones
  // are kept so they still list, with a "Vacant" marker in their empty months.
  const rentalAssetIds = new Set((rentalAssets ?? []).map((a) => a.id as string));
  const rows = new Map<string, CcRow>();
  for (const cc of costCenters ?? []) {
    if (!cc.asset_id || !rentalAssetIds.has(cc.asset_id as string)) continue;
    const leases = cc.asset_id ? leaseByAsset.get(cc.asset_id as string) ?? [] : [];
    const months = Array(12).fill(0) as number[];
    let total = 0;
    for (let m = 0; m < 12; m++) {
      let monthSum = 0;
      for (const lease of leases) {
        if (lease.monthly <= 0) continue;
        const active = (!lease.start || lease.start <= monthEnd(m)) && (!lease.end || lease.end >= monthStart(m));
        if (active) monthSum += lease.monthly;
      }
      months[m] = monthSum;
      total += monthSum;
    }
    // "Net Rent" column = combined monthly net rent across the property's leases.
    const est = leases.reduce((s, l) => s + (l.monthly > 0 ? l.monthly : 0), 0);
    rows.set(cc.id as string, {
      id: cc.id as string,
      code: cc.code as string,
      name: cc.name as string,
      country: (cc.country as string) ?? "",
      est,
      months,
      total,
    });
  }

  // Group rental properties by country — vacant ones included.
  const byCountry = new Map<string, CcRow[]>();
  for (const row of rows.values()) {
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
      formatAccountCode(r.code),
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
      {/* Toolbar — home/back, year, export and print on one line (the report name
          is shown by the breadcrumb, so there's no heading box) */}
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <ReportNav className="pb-1.5" />
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
        <div className="flex items-center gap-2">
          <CsvExportButton
            filename={`rent-report-${year}.csv`}
            headers={["Country", "Code", "Cost centre", "Net Rent", ...MONTHS, "Total"]}
            rows={exportRows}
          />
          <PrintButton />
        </div>
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
                label={`${COUNTRY[s.country]?.label ?? s.country} — Annual Net Rent`}
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
            <tr className="bg-primary text-primary-foreground [&>th]:border-r [&>th]:border-primary/40 [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
              <th className="sticky left-0 z-30 min-w-[240px] bg-primary text-left">Cost centre</th>
              <th className="whitespace-nowrap text-right">Net Rent</th>
              {MONTHS.map((m, i) => (
                <th key={m} className={cn("whitespace-nowrap text-right", i === thisMonth && "bg-white/15")}>
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
                          <span className="font-medium text-foreground">{r.name}</span>
                          {r.total === 0 && (
                            <span className="ml-2 rounded border border-amber-400/60 px-1.5 text-[0.6rem] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                              Vacant
                            </span>
                          )}
                        </td>
                        <td className="text-right font-mono tabular-nums text-muted-foreground">{r.est ? money(r.est) : dash}</td>
                        {r.months.map((v, i) => {
                          // A month entirely before the accounting period started
                          // is blank, not "Vacant".
                          const beforePeriod = periodStart != null && monthEnd(i) < periodStart;
                          return (
                            <td
                              key={i}
                              className={cn(
                                "text-right font-mono tabular-nums",
                                i === thisMonth && "bg-primary/[0.04]",
                                beforePeriod && "text-muted-foreground/40",
                              )}
                            >
                              {v ? (
                                money(v)
                              ) : beforePeriod ? (
                                dash
                              ) : (
                                <span className="text-[0.6rem] font-medium uppercase tracking-wide text-amber-600/80 dark:text-amber-400/80">
                                  Vacant
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-right font-mono font-semibold tabular-nums text-foreground">{money(r.total)}</td>
                      </tr>
                    );
                  })}
                  {/* Country total */}
                  <tr className="bg-primary font-semibold text-primary-foreground [&>td]:px-3 [&>td]:py-2">
                    <td className="sticky left-0 z-10 bg-primary text-xs uppercase tracking-wide">Total — {label}</td>
                    <td className="text-right font-mono tabular-nums">{secEst ? money(secEst) : dash}</td>
                    {secMonths.map((v, i) => (
                      <td key={i} className={cn("text-right font-mono tabular-nums", i === thisMonth && "bg-white/15")}>
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
    <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] to-transparent px-4 py-3.5 shadow-xs transition-shadow hover:shadow-md">
      <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />
      <p className="truncate pl-1.5 text-[0.68rem] font-semibold uppercase tracking-wide text-primary">{label}</p>
      <p className="mt-1 truncate pl-1.5 font-mono text-xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 truncate pl-1.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
