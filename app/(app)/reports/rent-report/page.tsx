import { Fragment, Suspense } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { CsvExportButton } from "@/components/reports/csv-export-button";
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
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: rentLines }, { data: costCenters }, { data: pkLeases }, { data: uaeLeases }, { data: currencies }] =
    await Promise.all([
      supabase
        .schema("reporting")
        .from("v_ledger_entries")
        .select("cost_center_id, cost_center_country, doc_debit_amount, doc_credit_amount, entry_date")
        .eq("company_id", companyId)
        .in("voucher_type", ["uae_rent_invoice", "pk_rent_invoice"])
        .eq("account_type", "income")
        .gte("entry_date", from)
        .lte("entry_date", to),
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
        .select("asset_id, monthly_rent")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .schema("rental")
        .from("uae_leases")
        .select("asset_id, rental_amount, rent_cycle")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase.schema("core").from("currencies").select("code, symbol"),
    ]);

  const symbolByCode = new Map((currencies ?? []).map((c) => [c.code as string, c.symbol as string]));

  // Estimated monthly rent per asset, from the active lease.
  const estByAsset = new Map<string, number>();
  for (const l of pkLeases ?? []) {
    if (l.asset_id) estByAsset.set(l.asset_id as string, Number(l.monthly_rent));
  }
  for (const l of uaeLeases ?? []) {
    if (!l.asset_id) continue;
    const monthly = l.rent_cycle === "yearly" ? Number(l.rental_amount) / 12 : Number(l.rental_amount);
    estByAsset.set(l.asset_id as string, monthly);
  }

  // One accumulator per cost centre.
  const rows = new Map<string, CcRow>();
  for (const cc of costCenters ?? []) {
    rows.set(cc.id as string, {
      id: cc.id as string,
      code: cc.code as string,
      name: cc.name as string,
      country: (cc.country as string) ?? "",
      est: cc.asset_id ? estByAsset.get(cc.asset_id as string) ?? 0 : 0,
      months: Array(12).fill(0),
      total: 0,
    });
  }
  for (const l of rentLines ?? []) {
    const ccId = l.cost_center_id as string | null;
    if (!ccId) continue;
    const row = rows.get(ccId);
    if (!row) continue;
    const month = Number((l.entry_date as string).slice(5, 7)) - 1;
    if (month < 0 || month > 11) continue;
    const amount = Number(l.doc_credit_amount) - Number(l.doc_debit_amount);
    row.months[month] += amount;
    row.total += amount;
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

  const totalRow = "bg-header text-header-foreground hover:bg-header [&>td]:border-header-border";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Rent Report"
        description={`Cost-centre-wise, month-wise rent billed for ${year}. UAE and Pakistan shown separately, each in its own currency.`}
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

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-56">Cost centre</TableHead>
              <TableHead className="text-right">Est. Rent</TableHead>
              {MONTHS.map((m) => (
                <TableHead key={m} className="text-right">
                  {m}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={15} className="py-10 text-center text-muted-foreground">
                  No rent billed for {year}.
                </TableCell>
              </TableRow>
            )}
            {sections.map((section) => {
              const cur = COUNTRY[section.country]?.code ?? "";
              const symbol = symbolByCode.get(cur) ?? cur;
              const money = (n: number) => (n ? `${symbol ? symbol + " " : ""}${formatMoney(n)}` : "");
              const secEst = section.rows.reduce((s, r) => s + r.est, 0);
              const secMonths = MONTHS.map((_, i) => section.rows.reduce((s, r) => s + r.months[i], 0));
              const secTotal = section.rows.reduce((s, r) => s + r.total, 0);
              return (
                <Fragment key={section.country}>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={15} className="font-semibold">
                      {COUNTRY[section.country]?.label ?? section.country}
                      {symbol ? ` — ${cur}` : ""}
                    </TableCell>
                  </TableRow>
                  {section.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{r.code}</span>
                        <span className="font-medium">{r.name}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(r.est)}</TableCell>
                      {r.months.map((v, i) => (
                        <TableCell key={i} className="text-right font-mono tabular-nums">
                          {money(v)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-mono font-medium tabular-nums">{money(r.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={totalRow}>
                    <TableCell className="font-medium">Total — {COUNTRY[section.country]?.label ?? section.country}</TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">{money(secEst)}</TableCell>
                    {secMonths.map((v, i) => (
                      <TableCell key={i} className="text-right font-mono font-medium tabular-nums">
                        {money(v)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-mono font-semibold tabular-nums">{money(secTotal)}</TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
