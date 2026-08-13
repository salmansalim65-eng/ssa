"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BuildingIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  ImageIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { ReportNav } from "@/components/reports/report-nav";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { aggregateGroup, type PropertyGroupTotals, type PropertyRow } from "@/lib/reports/property-report";
import {
  ChartCard,
  DonutChart,
  HBarChart,
  StackedBarChart,
  LineChart,
  CHART_COLORS,
  compactNumber,
} from "@/components/reports/charts";

export interface PropertyGroup {
  name: string;
  totals: PropertyGroupTotals;
  rows: PropertyRow[];
}

export interface MonthlyTrendPoint {
  month: string;
  label: string;
  total: number;
}

// Number / percent / rate formatters — grouped thousands, sensible decimals.
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const rate = (n: number) => (n ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "");
const pct = (n: number) => `${n.toFixed(2)}%`;
const dash = "—";

// The numeric columns after the Country / Property column (in display order).
const NUM_COLS: {
  key: keyof PropertyGroupTotals;
  label: string;
  full: string;
  kind: "money" | "rate" | "pct";
}[] = [
  { key: "estRent", label: "Est. Rent", full: "Estimated Rent (monthly)", kind: "money" },
  { key: "monthlyRent", label: "Monthly Rent", full: "Monthly Rent (from lease)", kind: "money" },
  { key: "yearlyRent", label: "Yearly Rent", full: "Yearly Rent (Monthly × 12)", kind: "money" },
  { key: "diffEstVsYearly", label: "Diff. Est/Yr", full: "Difference: Estimated × 12 − Yearly", kind: "money" },
  { key: "sqFt", label: "Sq. Ft", full: "Area (square feet)", kind: "money" },
  { key: "serviceCharges", label: "Maintenance", full: "Maintenance / service charges (Rate × Sq. Ft)", kind: "money" },
  { key: "netRent", label: "Net Rent", full: "Monthly: Monthly Rent − Service Charges ÷ 12", kind: "money" },
  { key: "currentValue", label: "Current Value", full: "Current property value", kind: "money" },
  { key: "perc", label: "Perc%", full: "Annualised yield: Net Rent × 12 ÷ Current Value", kind: "pct" },
  { key: "percMonth", label: "% Month", full: "Monthly yield: Perc% ÷ 12", kind: "pct" },
  { key: "purchaseValue", label: "Purchase Value", full: "Original purchase value", kind: "money" },
  { key: "diffValue", label: "Difference Value", full: "Current Value − Purchase Value", kind: "money" },
];

function fmt(kind: "money" | "rate" | "pct", n: number): string {
  if (kind === "pct") return pct(n);
  if (kind === "rate") return rate(n) || dash;
  return money(n);
}

// Service Rate sits between Sq. Ft Value and Service Charges but has no group
// total, so it's rendered from the row directly (not from NUM_COLS totals).
const CSV_HEADERS = [
  "Country",
  "Property",
  "Country Code",
  "Est. Rent",
  "Monthly Rent",
  "Yearly Rent",
  "Diff. Est vs Yearly",
  "Sq. Ft",
  "Sq. Ft Value",
  "Service Rate",
  "Service Charges",
  "Net Rent",
  "Current Value",
  "Perc%",
  "% Month",
  "Purchase Value",
  "Difference Value",
  "Maintenance%",
  "Title Deed Owner",
  "Occupancy",
];

export function PropertyReportView({
  groups,
  countries,
  totalCostCenters,
  totalProperties,
  monthlyTrend,
}: {
  groups: PropertyGroup[];
  countries: { code: string; name: string }[];
  totalCostCenters: number;
  totalProperties: number;
  monthlyTrend: MonthlyTrendPoint[];
}) {
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [country, setCountry] = useState("");
  const [occupancy, setOccupancy] = useState<"" | "occupied" | "vacant">("");
  const [propertyType, setPropertyType] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const propertyTypes = useMemo(
    () =>
      [...new Set(groups.flatMap((g) => g.rows.map((r) => r.propertyType)).filter(Boolean))].sort(),
    [groups],
  );

  // Apply filters + search, then recompute each group's totals from what remains.
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (r: PropertyRow) => {
      if (country && r.country !== country) return false;
      if (occupancy === "occupied" && !r.occupied) return false;
      if (occupancy === "vacant" && r.occupied) return false;
      if (propertyType && r.propertyType !== propertyType) return false;
      if (q) {
        const hay = `${r.name} ${r.assetCode} ${r.titleDeedOwner} ${r.group} ${r.country}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    return groups
      .map((g) => {
        const rows = g.rows.filter(match);
        return { name: g.name, rows, totals: aggregateGroup(rows) };
      })
      .filter((g) => g.rows.length > 0);
  }, [groups, search, country, occupancy, propertyType]);

  const visibleRows = useMemo(() => filteredGroups.flatMap((g) => g.rows), [filteredGroups]);
  const vacant = useMemo(() => visibleRows.filter((r) => !r.occupied), [visibleRows]);
  // Portfolio KPIs recompute from whatever the current filters leave visible.
  const portfolio = useMemo(() => aggregateGroup(visibleRows), [visibleRows]);
  const occupiedCount = visibleRows.length - vacant.length;
  const occupancyRate = visibleRows.length ? Math.round((occupiedCount / visibleRows.length) * 100) : 0;
  // Detail panel: a clicked property, or null → the portfolio-wide summary.
  const selected = useMemo(
    () => (selectedId ? visibleRows.find((r) => r.id === selectedId) ?? null : null),
    [visibleRows, selectedId],
  );
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedId]);
  const activeFilters = [country, occupancy, propertyType].filter(Boolean).length;

  // ----- Dashboard chart datasets (all recompute with the active filters) -----

  // Current value share by country (donut / bar). `group` is the country name.
  const byCountry = useMemo(() => {
    const map = new Map<string, { code: string; label: string; value: number; count: number }>();
    for (const r of visibleRows) {
      const code = r.country || "—";
      const e = map.get(code) ?? { code, label: r.group || code, value: 0, count: 0 };
      e.value += r.currentValue;
      e.count += 1;
      map.set(code, e);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [visibleRows]);

  const countryDonut = useMemo(
    () => byCountry.map((c, i) => ({ key: c.code, label: c.label, value: c.value, color: CHART_COLORS[i % CHART_COLORS.length] })),
    [byCountry],
  );

  const occupancyDonut = useMemo(
    () => [
      { key: "occupied", label: "Occupied", value: occupiedCount, color: CHART_COLORS[0] },
      { key: "vacant", label: "Vacant", value: vacant.length, color: CHART_COLORS[2] },
    ],
    [occupiedCount, vacant.length],
  );

  const topProperties = useMemo(
    () =>
      [...visibleRows]
        .filter((r) => r.currentValue > 0)
        .sort((a, b) => b.currentValue - a.currentValue)
        .slice(0, 8)
        .map((r) => ({ key: r.id, label: r.name, value: r.currentValue })),
    [visibleRows],
  );

  // Annual net rent + maintenance by property type (stacked → yearly rent).
  const rentByType = useMemo(() => {
    const map = new Map<string, { key: string; label: string; net: number; service: number }>();
    for (const r of visibleRows) {
      const t = r.propertyType || "Unspecified";
      const e = map.get(t) ?? { key: t, label: t, net: 0, service: 0 };
      e.net += Math.max(0, r.yearlyRent - r.serviceCharges); // annual net rent
      e.service += r.serviceCharges; // maintenance
      map.set(t, e);
    }
    return [...map.values()]
      .filter((g) => g.net > 0 || g.service > 0)
      .sort((a, b) => b.net + b.service - (a.net + a.service))
      .map((g) => ({ key: g.key, label: g.label, values: { "Net Rent": g.net, Maintenance: g.service } }));
  }, [visibleRows]);

  const trendTotal = useMemo(() => monthlyTrend.reduce((s, p) => s + p.total, 0), [monthlyTrend]);

  // Click a chart segment to toggle the matching table filter.
  const toggleCountry = (code: string) => setCountry((c) => (c === code ? "" : code));
  const toggleOccupancy = (k: string) =>
    setOccupancy((o) => (o === k ? "" : (k as "occupied" | "vacant")));
  const toggleType = (t: string) => setPropertyType((p) => (p === t ? "" : t));

  const csvRows = visibleRows.map((r) => [
    r.group,
    r.name,
    r.country,
    r.estRent,
    r.monthlyRent,
    r.yearlyRent,
    r.diffEstVsYearly,
    r.sqFt,
    r.sqFtValue,
    r.serviceRate,
    r.serviceCharges,
    r.netRent,
    r.currentValue,
    r.perc,
    r.percMonth,
    r.purchaseValue,
    r.diffValue,
    r.maintenancePct,
    r.titleDeedOwner,
    r.occupied ? "Occupied" : "Vacant",
  ]);

  function toggleGroup(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Column count for the frozen first column + numeric columns.
  const totalCols = 1 + NUM_COLS.length;

  // Charts render below the detailed table (see layout order in the return).
  const dashboardCharts = (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Property Value by Country"
          subtitle="Share of current portfolio value"
          csv={{
            headers: ["Country", "Current Value", "Properties", "Share %"],
            rows: byCountry.map((c) => {
              const total = byCountry.reduce((s, x) => s + x.value, 0);
              return [c.label, Math.round(c.value), c.count, total ? `${((c.value / total) * 100).toFixed(1)}%` : "0%"];
            }),
          }}
          chart={(h) =>
            countryDonut.length ? (
              <DonutChart
                data={countryDonut}
                height={h}
                format={money}
                centerTitle="Current Value"
                centerValue={compactNumber(portfolio.currentValue)}
                activeKey={country || null}
                onSelect={toggleCountry}
              />
            ) : (
              <EmptyChart height={h} />
            )
          }
        />
        <ChartCard
          title="Occupancy Status"
          subtitle="Occupied vs vacant properties"
          csv={{
            headers: ["Status", "Properties", "Share %"],
            rows: [
              ["Occupied", occupiedCount, `${occupancyRate}%`],
              ["Vacant", vacant.length, `${100 - occupancyRate}%`],
            ],
          }}
          chart={(h) =>
            visibleRows.length ? (
              <DonutChart
                data={occupancyDonut}
                height={h}
                format={(n) => `${Math.round(n)} properties`}
                centerTitle="Occupied"
                centerValue={`${occupancyRate}%`}
                activeKey={occupancy || null}
                onSelect={toggleOccupancy}
              />
            ) : (
              <EmptyChart height={h} />
            )
          }
        />
        <ChartCard
          title="Top Properties by Current Value"
          subtitle="Highest-valued properties (click to inspect)"
          csv={{
            headers: ["Property", "Current Value"],
            rows: topProperties.map((p) => [p.label, p.value]),
          }}
          chart={(h) =>
            topProperties.length ? (
              <HBarChart data={topProperties} height={h} format={money} onSelect={(id) => setSelectedId(id)} />
            ) : (
              <EmptyChart height={h} />
            )
          }
        />
        <ChartCard
          title="Rent & Maintenance by Type"
          subtitle="Annual net rent and maintenance per property type"
          csv={{
            headers: ["Property Type", "Net Rent", "Maintenance", "Yearly Rent"],
            rows: rentByType.map((g) => [
              g.label,
              Math.round(g.values["Net Rent"]),
              Math.round(g.values["Maintenance"]),
              Math.round(g.values["Net Rent"] + g.values["Maintenance"]),
            ]),
          }}
          chart={(h) =>
            rentByType.length ? (
              <StackedBarChart
                groups={rentByType}
                series={[
                  { name: "Net Rent", color: CHART_COLORS[0] },
                  { name: "Maintenance", color: CHART_COLORS[2] },
                ]}
                height={h}
                format={money}
                onSelect={toggleType}
              />
            ) : (
              <EmptyChart height={h} />
            )
          }
        />
      </div>

      <ChartCard
        title="Monthly Rental Income Trend"
        subtitle="Invoiced lease income over the last 12 months"
        csv={{ headers: ["Month", "Rental Income"], rows: monthlyTrend.map((p) => [p.label, p.total]) }}
        chart={(h) =>
          trendTotal > 0 ? (
            <LineChart points={monthlyTrend.map((p) => ({ label: p.label, value: p.total }))} height={h} format={money} />
          ) : (
            <EmptyChart height={h} label="No invoiced rental income in the last 12 months." />
          )
        }
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <ReportNav className="print:hidden" />

      {/* Header */}
      <div className="rounded-xl border bg-card px-5 py-4 shadow-xs print:border-0 print:px-0 print:shadow-none">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Reports</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Rental Property Report</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Portfolio overview and analysis ·{" "}
              <span className="font-semibold text-foreground">{visibleRows.length}</span> of{" "}
              <span className="font-semibold text-foreground">{totalProperties}</span> rental properties
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search property, code, owner…"
                className="w-64 pl-8"
              />
            </div>
            <Button
              variant={showFilters || activeFilters > 0 ? "default" : "outline"}
              onClick={() => setShowFilters((s) => !s)}
            >
              <SlidersHorizontalIcon /> Filters
              {activeFilters > 0 && (
                <span className="ml-1 rounded bg-white/25 px-1.5 text-xs">{activeFilters}</span>
              )}
            </Button>
            <CsvExportButton filename="property-report.csv" headers={CSV_HEADERS} rows={csvRows} />
            <PrintButton />
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-3 print:hidden">
            <FilterSelect label="Country" value={country} onChange={setCountry} options={countries.map((c) => ({ value: c.code, label: c.name }))} allLabel="All countries" />
            <FilterSelect label="Occupancy" value={occupancy} onChange={(v) => setOccupancy(v as "" | "occupied" | "vacant")} options={[{ value: "occupied", label: "Occupied" }, { value: "vacant", label: "Vacant" }]} allLabel="All" />
            <FilterSelect label="Property type" value={propertyType} onChange={setPropertyType} options={propertyTypes.map((t) => ({ value: t, label: t }))} allLabel="All types" />
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCountry("");
                  setOccupancy("");
                  setPropertyType("");
                }}
                className="self-end text-sm font-medium text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* KPI cards — recompute with the active filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi label="Total Properties" value={visibleRows.length.toLocaleString("en-US")} sub={`${occupiedCount} occupied · ${vacant.length} vacant`} accent={CHART_COLORS[1]} />
        <Kpi label="Occupied" value={occupiedCount.toLocaleString("en-US")} sub={`${occupancyRate}% of portfolio`} accent={CHART_COLORS[0]} />
        <Kpi label="Vacant" value={vacant.length.toLocaleString("en-US")} sub={`${100 - occupancyRate}% of portfolio`} accent={CHART_COLORS[2]} />
        <Kpi label="Current Value" value={money(portfolio.currentValue)} sub={portfolio.diffValue >= 0 ? `▲ ${money(portfolio.diffValue)} vs purchase` : `▼ ${money(-portfolio.diffValue)} vs purchase`} tone={portfolio.diffValue >= 0 ? "up" : "down"} accent={CHART_COLORS[0]} />
        <Kpi label="Purchase Value" value={money(portfolio.purchaseValue)} sub="Original cost" accent={CHART_COLORS[6]} />
        <Kpi label="Monthly Rent" value={money(portfolio.monthlyRent)} sub={`${money(portfolio.yearlyRent)} / year`} accent={CHART_COLORS[1]} />
        <Kpi label="Yearly Rent" value={money(portfolio.yearlyRent)} sub={`Avg yield ${pct(portfolio.perc)}`} accent={CHART_COLORS[3]} />
        <Kpi label="Net Rent" value={money(portfolio.netRent)} sub={`Service ${money(portfolio.serviceCharges)}`} accent={CHART_COLORS[2]} />
      </div>

      {/* Total cost centers banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ledger/30 bg-ledger/10 px-4 py-2.5">
        <p className="text-sm font-bold uppercase tracking-wide text-ledger-dark">
          Total Rental Properties: {visibleRows.length}
          {visibleRows.length !== totalCostCenters && (
            <span className="font-medium normal-case text-muted-foreground"> of {totalCostCenters}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {vacant.length} vacant · {occupiedCount} occupied
        </p>
      </div>

      {/* Detail panel — portfolio summary by default, one property when clicked */}
      <div ref={detailRef} className="scroll-mt-4">
        {selected ? (
          <PropertyDetail row={selected} onClear={() => setSelectedId(null)} />
        ) : (
          <PortfolioDetail
            count={visibleRows.length}
            occupied={occupiedCount}
            vacant={vacant.length}
            occupancyRate={occupancyRate}
            totals={portfolio}
          />
        )}
      </div>

      {/* Main grouped table */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card shadow-xs">
        <table className="min-w-[1500px] w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-header text-header-foreground [&>th]:border-r [&>th]:border-header-border [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
              <th className="sticky left-0 z-30 min-w-[220px] bg-header text-left">Country / Property</th>
              {NUM_COLS.map((c) => (
                <th key={c.key} title={c.full} className="whitespace-nowrap text-right">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredGroups.map((g) => {
              const isCollapsed = collapsed.has(g.name);
              return (
                <Fragment key={g.name}>
                  {/* Group total row */}
                  <tr
                    className="cursor-pointer border-b border-ledger-dark/30 bg-ledger-dark text-white hover:bg-ledger-dark/90 [&>td]:px-3 [&>td]:py-2"
                    onClick={() => toggleGroup(g.name)}
                  >
                    <td className="sticky left-0 z-10 min-w-[220px] bg-ledger-dark font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        {isCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
                        {g.name}
                        <span className="ml-1 rounded bg-white/20 px-1.5 text-[0.7rem] font-medium">
                          {g.rows.length}
                        </span>
                      </span>
                    </td>
                    {NUM_COLS.map((c) => (
                      <td key={c.key} className="text-right font-mono font-semibold tabular-nums">
                        {fmt(c.kind, g.totals[c.key])}
                      </td>
                    ))}
                  </tr>

                  {/* Child property rows */}
                  {!isCollapsed &&
                    g.rows.map((r, i) => {
                      const isSel = selectedId === r.id;
                      const rowBg = isSel ? "bg-primary/10" : i % 2 ? "bg-muted/40" : "bg-card";
                      return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedId((cur) => (cur === r.id ? null : r.id))}
                        className={cn(
                          "group/row cursor-pointer border-b border-border/50 [&>td]:px-3 [&>td]:py-2.5",
                          rowBg,
                          !isSel && "hover:bg-primary/[0.06]",
                        )}
                      >
                        <td
                          className={cn(
                            "sticky left-0 z-10 min-w-[220px] border-r border-border/50 pl-8",
                            rowBg,
                            !isSel && "group-hover/row:bg-primary/[0.06]",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-foreground" title={r.name}>
                              {r.name}
                            </span>
                            {!r.occupied && (
                              <Badge variant="outline" className="shrink-0 border-amber-400/60 text-amber-600 dark:text-amber-400">
                                Vacant
                              </Badge>
                            )}
                          </div>
                        </td>
                        {NUM_COLS.map((c) => (
                          <td key={c.key} className="text-right font-mono tabular-nums">
                            {fmt(c.kind, r[c.key as keyof PropertyRow] as number)}
                          </td>
                        ))}
                      </tr>
                      );
                    })}
                </Fragment>
              );
            })}
            {filteredGroups.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="py-12 text-center text-muted-foreground">
                  No properties match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Vacant properties */}
      <div className="rounded-lg border bg-card p-4 shadow-xs">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ledger-dark">
          Vacant Properties ({vacant.length})
        </h2>
        {vacant.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vacant properties.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {vacant.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/50 bg-amber-50 px-2.5 py-1 text-sm text-amber-800 transition-colors hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <BuildingIcon className="size-3.5" />
                <span className="truncate">{r.name}</span>
                <span className="font-mono text-[0.7rem] opacity-70">{r.country}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Dashboard charts — below the detailed table */}
      {dashboardCharts}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
  accent?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card px-4 py-3.5 shadow-xs">
      {accent && <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />}
      <p className="truncate text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 truncate font-mono text-xl font-bold tabular-nums",
          tone === "up" && "text-ledger-dark",
          tone === "down" && "text-destructive",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function EmptyChart({ height, label = "No data available." }: { height: number; label?: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
      style={{ minHeight: height }}
    >
      {label}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-1.5">
      <p className="truncate text-[0.6rem] font-semibold uppercase tracking-wide text-ledger-dark">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-mono text-[0.8rem] font-semibold tabular-nums",
          tone === "up" && "text-ledger-dark",
          tone === "down" && "text-destructive",
          !tone && "text-foreground",
        )}
      >
        {value || dash}
      </p>
    </div>
  );
}

const detailWhite = "border-white/30 bg-transparent text-white hover:bg-white/15 hover:text-white";

function PropertyDetail({ row, onClear }: { row: PropertyRow; onClear: () => void }) {
  return (
    <div className="rounded-xl border border-ledger-dark/40 bg-card shadow-xs">
      {/* Header — name, meta, and the documents / images strip (kept here to save space) */}
      <div className="flex flex-col gap-2 border-b border-ledger-dark bg-ledger-dark px-4 py-2.5 text-white lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{row.name}</p>
            <Badge
              variant="outline"
              className={cn("border-white/40 text-white", row.occupied ? "bg-white/15" : "bg-amber-500/30")}
            >
              {row.occupied ? "Occupied" : "Vacant"}
            </Badge>
          </div>
          <p className="truncate font-mono text-[0.7rem] text-white/70">
            {[row.assetCode, row.propertyType, row.group].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.images.slice(0, 4).map((img, i) => (
            <a
              key={i}
              href={img.url}
              target="_blank"
              rel="noreferrer"
              title={img.fileName}
              className="relative size-9 overflow-hidden rounded-md border border-white/25"
            >
              <Image src={img.url} alt={img.fileName} fill sizes="36px" className="object-cover" unoptimized />
            </a>
          ))}
          {row.imageCount > 4 && (
            <span className="inline-flex size-9 items-center justify-center rounded-md border border-white/25 bg-white/10 text-[0.7rem]">
              +{row.imageCount - 4}
            </span>
          )}
          {row.imageCount === 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-1 text-[0.7rem] text-white/70">
              <ImageIcon className="size-3.5" /> No images
            </span>
          )}
          {row.titleDeedUrl && (
            <a
              href={row.titleDeedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[0.7rem] transition-colors hover:bg-white/20"
            >
              <FileTextIcon className="size-3.5" /> Title deed
            </a>
          )}
          <Button asChild variant="outline" size="sm" className={cn("h-8", detailWhite)}>
            <Link href={`/assets/${row.id}`}>Open</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onClear} className={cn("h-8", detailWhite)}>
            All properties
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <section>
          <h3 className="mb-1.5 text-[0.7rem] font-bold uppercase tracking-wide text-ledger-dark">Property Value</h3>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
            <Field label="Pur. Date" value={row.purchaseDate ? formatDate(row.purchaseDate) : ""} />
            <Field label="Pur. Value" value={money(row.purchaseValue)} />
            <Field label="Current Value" value={money(row.currentValue)} />
            <Field label="Diff. Value" value={money(row.diffValue)} tone={row.diffValue >= 0 ? "up" : "down"} />
            <Field label="Val. Year" value={row.valuationYear ? String(row.valuationYear) : ""} />
            <Field label="Sq. Ft" value={money(row.sqFt)} />
            <Field label="Sq. Ft Value" value={rate(row.sqFtValue)} />
            <Field label="T. Deed Value" value={money(row.titleDeedValue)} />
            <Field label="T. Deed Owner" value={row.titleDeedOwner} />
          </div>
        </section>

        <section>
          <h3 className="mb-1.5 text-[0.7rem] font-bold uppercase tracking-wide text-ledger-dark">Rental &amp; Maintenance</h3>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
            <Field label="Est. Rent" value={money(row.estRent)} />
            <Field label="Monthly Rent" value={money(row.monthlyRent)} />
            <Field label="Yearly Rent" value={money(row.yearlyRent)} />
            <Field label="Net Rent /mo" value={money(row.netRent)} />
            <Field label="Service Rate" value={rate(row.serviceRate)} />
            <Field label="Maint. %" value={pct(row.maintenancePct)} />
            <Field label="Start Date" value={row.leaseStart ? formatDate(row.leaseStart) : ""} />
            <Field label="End Date" value={row.leaseEnd ? formatDate(row.leaseEnd) : ""} />
            <Field label="Renew Month" value={row.renewMonth ?? ""} />
          </div>
        </section>
      </div>
    </div>
  );
}

function PortfolioDetail({
  count,
  occupied,
  vacant,
  occupancyRate,
  totals,
}: {
  count: number;
  occupied: number;
  vacant: number;
  occupancyRate: number;
  totals: PropertyGroupTotals;
}) {
  return (
    <div className="rounded-xl border border-ledger-dark/40 bg-card shadow-xs">
      <div className="flex items-center justify-between gap-2 border-b border-ledger-dark bg-ledger-dark px-4 py-2.5 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">All Properties</p>
          <p className="truncate font-mono text-[0.7rem] text-white/70">
            {count} properties · {occupied} occupied · {vacant} vacant
          </p>
        </div>
        <Badge variant="outline" className="border-white/40 bg-white/15 text-white">
          Portfolio summary
        </Badge>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-[0.7rem] text-muted-foreground">Click any property row for its full detail.</p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          <Field label="Properties" value={count.toLocaleString("en-US")} />
          <Field label="Occupied" value={occupied.toLocaleString("en-US")} />
          <Field label="Vacant" value={vacant.toLocaleString("en-US")} />
          <Field label="Occupancy" value={`${occupancyRate}%`} />
          <Field label="Current Value" value={money(totals.currentValue)} />
          <Field label="Purchase Value" value={money(totals.purchaseValue)} />
          <Field label="Diff. Value" value={money(totals.diffValue)} tone={totals.diffValue >= 0 ? "up" : "down"} />
          <Field label="Monthly Rent" value={money(totals.monthlyRent)} />
          <Field label="Yearly Rent" value={money(totals.yearlyRent)} />
          <Field label="Net Rent /mo" value={money(totals.netRent)} />
          <Field label="Maintenance" value={money(totals.serviceCharges)} />
          <Field label="Avg. Yield" value={pct(totals.perc)} />
        </div>
      </div>
    </div>
  );
}
