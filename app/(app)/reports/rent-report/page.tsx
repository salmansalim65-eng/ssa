import { Fragment, Suspense } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { ReportNav } from "@/components/reports/report-nav";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { formatAccountCode, formatDate, formatMoney } from "@/lib/format";
import { HH_AGENT_PCT, UAE_AGENT_PCT } from "@/lib/rental/lease-accounting";
import { billingMonthStarts, billingMonthCount } from "@/lib/rental/billing-months";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Cost-centre country → display label + the country's own currency code.
const COUNTRY: Record<string, { label: string; code: string }> = {
  AE: { label: "United Arab Emirates", code: "AED" },
  PK: { label: "Pakistan", code: "PKR" },
  SA: { label: "Saudi Arabia", code: "SAR" },
};

// Whole RENTAL months a lease period spans (3 Aug → 2 Sep = 1). Used to spread a
// period-total expense across the months so it is deducted once, not per month.
function leaseMonthCount(start: string | null, end: string | null): number {
  if (!start || !end) return 1;
  return billingMonthCount(start, end);
}

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
  searchParams: Promise<{ year?: string; asset?: string; country?: string }>;
}) {
  const currentYear = new Date().getFullYear();
  const { year: yearParam = "", asset: assetParam = "", country: countryParam = "" } = await searchParams;
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
        .select("asset_id, tenant_id, monthly_rent, lease_start, lease_end, rent_month")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .schema("rental")
        .from("uae_leases")
        .select("id, asset_id, tenant_id, rental_amount, rent_cycle, lease_start, lease_end, lease_type, rent_month, document_no, created_at")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("created_at"),
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

  // "MMM YYYY" label for a date (used for the renew month).
  const monthLabel = (d: string | null | undefined) => {
    const m = /^(\d{4})-(\d{2})/.exec(String(d ?? ""));
    return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
  };

  // Active lease per asset: monthly rent + period, so a monthly lease shows its
  // monthly rent in EVERY month it covers (not a lump where its invoice posted).
  interface AssetLease {
    monthly: number;
    gross: number; // contract monthly rent (before deductions)
    start: string | null;
    end: string | null;
    renew: string | null; // rent_month label, else derived from lease end
    tenantId: string | null;
    billingKeys: Set<string>; // "YYYY-MM" of each rental month the lease bills
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
  const billingKeysOf = (start: string | null, end: string | null) =>
    new Set(start && end ? billingMonthStarts(start, end).map((d) => d.slice(0, 7)) : []);
  for (const l of pkLeases ?? []) {
    if (!l.asset_id) continue;
    addLease(l.asset_id as string, {
      monthly: Number(l.monthly_rent) || 0,
      gross: Number(l.monthly_rent) || 0,
      start: (l.lease_start as string) ?? null,
      end: (l.lease_end as string) ?? null,
      renew: (l.rent_month as string) || monthLabel(l.lease_end as string),
      tenantId: (l.tenant_id as string) ?? null,
      billingKeys: billingKeysOf((l.lease_start as string) ?? null, (l.lease_end as string) ?? null),
    });
  }
  // Drop any stray duplicate lease for the same property within one voucher
  // (keep the most recent — rows come oldest-first) so a property's monthly rent
  // is never counted twice. Leases without a voucher number are kept as-is.
  const uaeDedupByKey = new Map<string, NonNullable<typeof uaeLeases>[number]>();
  const uaeLeasesDeduped: NonNullable<typeof uaeLeases> = [];
  for (const l of uaeLeases ?? []) {
    const doc = l.document_no as string | null;
    if (!doc || !l.asset_id) uaeLeasesDeduped.push(l);
    else uaeDedupByKey.set(`${doc}|${l.asset_id}`, l);
  }
  uaeLeasesDeduped.push(...uaeDedupByKey.values());

  for (const l of uaeLeasesDeduped) {
    if (!l.asset_id) continue;
    const gross = l.rent_cycle === "yearly" ? Number(l.rental_amount) / 12 : Number(l.rental_amount) || 0;
    // Net rent = rent − management (agent share: HH 10% / UAE 5%) − HH expenses.
    const isHh = l.lease_type === "hh";
    const management = gross * (isHh ? HH_AGENT_PCT : UAE_AGENT_PCT);
    // lease_expenses stores the whole-period total; spread it per month so it is
    // deducted once across the lease, not in full every month.
    const months = leaseMonthCount(l.lease_start as string | null, l.lease_end as string | null);
    const expenses = isHh ? (expenseByLease.get(l.id as string) ?? 0) / months : 0;
    const net = Math.max(0, gross - management - expenses);
    addLease(l.asset_id as string, {
      monthly: net,
      gross,
      start: (l.lease_start as string) ?? null,
      end: (l.lease_end as string) ?? null,
      renew: (l.rent_month as string) || monthLabel(l.lease_end as string),
      tenantId: (l.tenant_id as string) ?? null,
      billingKeys: billingKeysOf((l.lease_start as string) ?? null, (l.lease_end as string) ?? null),
    });
  }

  // Month end boundary for the selected year (used to blank pre-period months).
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
        // A property bills in a calendar month only if a rental month STARTS in
        // it — so a 3 Aug → 2 Sep lease shows in August only, not September.
        const active = lease.billingKeys.has(`${year}-${String(m + 1).padStart(2, "0")}`);
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
  const countryOptions = order
    .filter((c) => byCountry.has(c))
    .map((c) => ({ value: c, label: COUNTRY[c]?.label ?? c }));
  const sections = order
    .filter((c) => byCountry.has(c) && (!countryParam || c === countryParam))
    .map((c) => ({ country: c, rows: byCountry.get(c)! }));

  const yearOptions = [1, 2, 3, 4].map((n) => ({ value: String(currentYear - n), label: String(currentYear - n) }));

  // Property selector + selected property's lease term (start / end / renew).
  const assetOptions = [...rows.values()]
    .filter((r) => !countryParam || r.country === countryParam)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ value: r.id, label: r.name }));
  let selectedDetail:
    | { name: string; start: string | null; end: string | null; renew: string; tenant: string; rent: string }
    | null = null;
  if (assetParam) {
    const cc = (costCenters ?? []).find((c) => c.id === assetParam);
    // Fall back to the dropdown label so a picked property always resolves a name.
    const optLabel = assetOptions.find((o) => o.value === assetParam)?.label;
    if (cc || optLabel) {
      const assetId = (cc?.asset_id as string | undefined) ?? undefined;
      const leases = assetId ? leaseByAsset.get(assetId) ?? [] : [];
      const starts = leases.map((l) => l.start).filter((d): d is string => Boolean(d));
      const ends = leases.map((l) => l.end).filter((d): d is string => Boolean(d));
      const start = starts.length ? starts.reduce((min, d) => (d < min ? d : min)) : null;
      const end = ends.length ? ends.reduce((max, d) => (d > max ? d : max)) : null;
      const renew = leases.map((l) => l.renew).find((v): v is string => Boolean(v)) || monthLabel(end);
      const grossMonthly = leases.reduce((s, l) => s + (l.gross > 0 ? l.gross : 0), 0);
      const cur = COUNTRY[(cc?.country as string) ?? ""]?.code ?? "";
      const symbol = symbolByCode.get(cur) ?? cur;
      // Resolve tenant name(s) for the property's active lease(s).
      const tenantIds = [...new Set(leases.map((l) => l.tenantId).filter((v): v is string => Boolean(v)))];
      let tenant = leases.length ? "—" : "Vacant";
      if (tenantIds.length) {
        const { data: tenantRows } = await supabase
          .schema("rental")
          .from("tenants")
          .select("id, name")
          .in("id", tenantIds);
        const names = [...new Set((tenantRows ?? []).map((t) => t.name as string).filter(Boolean))];
        if (names.length) tenant = names.join(", ");
      }
      selectedDetail = {
        name: (cc?.name as string) ?? optLabel ?? "Property",
        start,
        end,
        renew: renew || "—",
        tenant,
        rent: grossMonthly ? `${symbol ? symbol + " " : ""}${formatMoney(grossMonthly)}` : "—",
      };
    }
  }

  const exportRows = sections.flatMap((s) =>
    s.rows.map((r, i) => [
      i + 1,
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
  // Months after the current month are in the future — leave them blank rather
  // than flagging "Vacant" (we can't know a property will be vacant then).
  const nowMonthIdx = new Date().getMonth();
  const isFutureMonth = (i: number) => year > currentYear || (year === currentYear && i > nowMonthIdx);
  const totalCols = 16; // S.No + cost centre + est + 12 months + total
  // Link a property row to itself as the selected property (fills the term
  // cards), preserving the year/country filters. Clicking the active one clears it.
  const propHref = (id: string) => {
    const qp = new URLSearchParams();
    if (yearParam) qp.set("year", yearParam);
    if (countryParam) qp.set("country", countryParam);
    if (assetParam !== id) qp.set("asset", id);
    const s = qp.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <div className="flex h-[calc(100dvh-var(--vh-offset,5.5rem))] min-h-0 flex-col gap-4 print:block print:h-auto print:gap-0">
      {/* Toolbar — home/back, year, export and print on one line (the report name
          is shown by the breadcrumb, so there's no heading box) */}
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 print:hidden">
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
          <Suspense>
            <ReportSelectFilter
              label="Country"
              param="country"
              allLabel="All countries"
              options={countryOptions}
              selected={countryParam}
              width="w-48"
            />
          </Suspense>
          <Suspense>
            <ReportSelectFilter
              label="Property"
              param="asset"
              allLabel="Select a property"
              options={assetOptions}
              selected={assetParam}
              width="w-56"
            />
          </Suspense>
        </div>
        <div className="flex items-center gap-2">
          <CsvExportButton
            filename={`rent-report-${year}.csv`}
            headers={["S.No", "Country", "Code", "Cost centre", "Net Rent", ...MONTHS, "Total"]}
            rows={exportRows}
          />
          <PrintButton />
        </div>
      </div>

      {/* Selected property's lease term + per-country annual-rent summary,
          frozen together at the top so they stay visible while scrolling the
          matrix. */}
      <div className="shrink-0 space-y-3">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            Lease term —{" "}
            <span className="text-muted-foreground">{selectedDetail ? selectedDetail.name : "select a property"}</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <TermCard label="Tenant" value={selectedDetail?.tenant ?? "—"} />
            <TermCard label="Monthly Rent" value={selectedDetail?.rent ?? "—"} />
            <TermCard label="Start Date" value={selectedDetail?.start ? formatDate(selectedDetail.start) : "—"} />
            <TermCard label="End Date" value={selectedDetail?.end ? formatDate(selectedDetail.end) : "—"} />
            <TermCard label="Renew Month" value={selectedDetail?.renew ?? "—"} />
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
      </div>

      {/* Month-wise rent matrix */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border bg-card shadow-xs print:h-auto print:overflow-visible">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-primary text-primary-foreground [&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:border-r [&>th]:border-primary/40 [&>th]:bg-primary [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
              <th className="sticky left-0 top-0 z-30 w-12 bg-primary text-right">S.No</th>
              <th className="sticky left-12 top-0 z-30 min-w-[240px] bg-primary text-left">Cost centre</th>
              <th className="whitespace-nowrap text-right bg-white/20">Net Rent</th>
              {MONTHS.map((m, i) => (
                <th key={m} className={cn("whitespace-nowrap text-right", i === thisMonth && "bg-white/15")}>
                  {m}
                </th>
              ))}
              <th className="whitespace-nowrap text-right bg-white/20">Total</th>
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
                        <td className={cn("sticky left-0 z-10 w-12 border-r border-border/50 text-right font-mono text-xs tabular-nums text-muted-foreground", rowBg, "group-hover/row:bg-primary/[0.05]")}>
                          {ri + 1}
                        </td>
                        <td className={cn("sticky left-12 z-10 min-w-[240px] border-r border-border/50", rowBg, "group-hover/row:bg-primary/[0.05]")}>
                          <Link
                            href={propHref(r.id)}
                            scroll={false}
                            className={cn(
                              "font-medium text-foreground hover:text-primary hover:underline",
                              assetParam === r.id && "text-primary underline",
                            )}
                          >
                            {r.name}
                          </Link>
                          {r.total === 0 && (
                            <span className="ml-2 rounded border border-amber-400/60 px-1.5 text-[0.6rem] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                              Vacant
                            </span>
                          )}
                        </td>
                        <td className="text-right font-mono font-semibold tabular-nums text-foreground bg-primary/[0.07]">
                          {r.est ? money(r.est) : dash}
                        </td>
                        {r.months.map((v, i) => {
                          // A month entirely before the accounting period started,
                          // or in the future, is blank — never flagged "Vacant".
                          const beforePeriod = periodStart != null && monthEnd(i) < periodStart;
                          const blankMonth = beforePeriod || isFutureMonth(i);
                          return (
                            <td
                              key={i}
                              className={cn(
                                "text-right font-mono tabular-nums",
                                // Current month stands out in bold dark green.
                                i === thisMonth && "bg-primary/[0.08] font-semibold text-green-700 dark:text-green-400",
                                // Only empty (dash) cells are muted — real amounts in
                                // any month show in the normal colour, not faded.
                                blankMonth && !v && "text-muted-foreground/40",
                              )}
                            >
                              {v ? (
                                money(v)
                              ) : blankMonth ? (
                                dash
                              ) : (
                                <span className="text-[0.6rem] font-medium uppercase tracking-wide text-amber-600/80 dark:text-amber-400/80">
                                  Vacant
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-right font-mono font-semibold tabular-nums text-foreground bg-primary/[0.07]">
                          {money(r.total)}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Country total */}
                  <tr className="bg-primary font-semibold text-primary-foreground [&>td]:px-3 [&>td]:py-2">
                    <td colSpan={2} className="sticky left-0 z-10 bg-primary text-xs uppercase tracking-wide">Total — {label}</td>
                    <td className="text-right font-mono tabular-nums bg-white/20">{secEst ? money(secEst) : dash}</td>
                    {secMonths.map((v, i) => (
                      <td key={i} className={cn("text-right font-mono tabular-nums", i === thisMonth && "bg-white/20")}>
                        {v ? money(v) : dash}
                      </td>
                    ))}
                    <td className="text-right font-mono tabular-nums bg-white/20">{money(secTotal)}</td>
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

function TermCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-xl border shadow-xs">
      <div className="bg-ledger-dark px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">{label}</div>
      <div className="bg-card px-4 py-3 font-mono text-lg font-semibold tabular-nums text-foreground">{value}</div>
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
