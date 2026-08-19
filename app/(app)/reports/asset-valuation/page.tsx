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
import { PrintButton } from "@/components/vouchers/print-button";
import { ReportCountryFilter } from "@/components/reports/report-country-filter";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { ReportNav } from "@/components/reports/report-nav";
import { loadReportCountries } from "@/lib/reports/countries";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";

// Fallback currency by country when an asset has no explicit currency_id.
const CURRENCY_BY_COUNTRY: Record<string, string> = { PK: "PKR", AE: "AED", SA: "SAR" };

export default async function AssetValuationReportPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; cc?: string; cur?: string }>;
}) {
  const { country = "", cc = "", cur = "" } = await searchParams;
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: valuationRows },
    { data: assetRows },
    { data: costCenters },
    { data: currencyRows },
    { data: companyCurrencies },
    { data: exchangeRates },
    countries,
  ] = await Promise.all([
    supabase.schema("assets").from("v_asset_valuation").select("*").eq("company_id", companyId).order("asset_code"),
    supabase.schema("assets").from("assets").select("id, currency_id").eq("company_id", companyId).is("deleted_at", null),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, name, asset_id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .not("asset_id", "is", null),
    supabase.schema("core").from("currencies").select("id, code, symbol"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currency_id, is_base_currency, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("core")
      .from("exchange_rates")
      .select("currency_id, rate_to_base, rate_date")
      .eq("company_id", companyId)
      .lte("rate_date", today)
      .order("rate_date", { ascending: false }),
    loadReportCountries(companyId),
  ]);

  // Currency plumbing (mirrors the Rental Property Report): each asset's value is
  // in its own currency; a chosen display currency converts asset→base→target.
  const currencyById = new Map((currencyRows ?? []).map((c) => [c.id as string, { code: c.code as string, symbol: c.symbol as string }]));
  const currencyIdByCode = new Map((currencyRows ?? []).map((c) => [c.code as string, c.id as string]));
  const currencyIdOfAsset = new Map(
    (assetRows ?? []).map((a) => [a.id as string, (a.currency_id as string) ?? null]),
  );
  const baseCurrencyId = ((companyCurrencies ?? []).find((c) => c.is_base_currency)?.currency_id as string) ?? null;
  const rateToBase: Record<string, number> = {};
  if (baseCurrencyId) rateToBase[baseCurrencyId] = 1;
  for (const r of exchangeRates ?? []) {
    const id = r.currency_id as string;
    if (!(id in rateToBase)) rateToBase[id] = Number(r.rate_to_base) || 0;
  }
  const currencyOptions = (companyCurrencies ?? [])
    .map((c) => c.currency_id as string)
    .filter((id) => id in rateToBase && (rateToBase[id] ?? 0) > 0)
    .map((id) => ({ value: id, label: currencyById.get(id)?.code ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Cost centre per asset (+ options for the filter).
  const ccByAsset = new Map((costCenters ?? []).map((c) => [c.asset_id as string, { id: c.id as string, name: c.name as string }]));
  const costCenterOptions = [...new Map((costCenters ?? []).map((c) => [c.id as string, c.name as string])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const currencyIdForAsset = (assetId: string, countryCode: string): string | null => {
    const own = currencyIdOfAsset.get(assetId);
    if (own) return own;
    const code = CURRENCY_BY_COUNTRY[countryCode];
    return code ? currencyIdByCode.get(code) ?? null : null;
  };

  const targetRate = cur && rateToBase[cur] ? rateToBase[cur] : 0;
  const selectedSymbol = cur ? currencyById.get(cur)?.symbol ?? "" : "";
  const selectedCode = cur ? currencyById.get(cur)?.code ?? "" : "";

  // Filter + shape rows.
  const rows = (valuationRows ?? [])
    .filter((r) => (country ? r.country === country : true))
    .filter((r) => (cc ? ccByAsset.get(r.asset_id as string)?.id === cc : true))
    .map((r) => {
      const assetId = r.asset_id as string;
      const curId = currencyIdForAsset(assetId, (r.country as string) ?? "");
      const src = curId ? rateToBase[curId] : undefined;
      const factor = targetRate && src ? src / targetRate : 1;
      const symbol = cur ? selectedSymbol : curId ? currencyById.get(curId)?.symbol ?? "" : "";
      return {
        assetId,
        code: r.asset_code as string,
        name: r.asset_name as string,
        location: [r.city, r.country].filter(Boolean).join(", "),
        costCenter: ccByAsset.get(assetId)?.name ?? "",
        symbol,
        purchase: (Number(r.purchase_value) || 0) * factor,
        current: (Number(r.current_value) || 0) * factor,
        variance: (Number(r.variance) || 0) * factor,
        valuationDate: r.latest_valuation_date as string | null,
        valuer: (r.latest_valuer as string) ?? "",
      };
    });

  const totalPurchase = rows.reduce((s, r) => s + r.purchase, 0);
  const totalCurrent = rows.reduce((s, r) => s + r.current, 0);
  // Totals only carry a symbol when a single display currency is in force.
  const totalSymbol = cur ? selectedSymbol : "";
  const money = (symbol: string, n: number) => `${symbol ? `${symbol} ` : ""}${formatMoney(n)}`;

  const csvRows = rows.map((r, i) => [
    i + 1,
    r.code,
    r.name,
    r.location,
    r.costCenter,
    r.symbol || (cur ? selectedCode : ""),
    Math.round(r.purchase),
    Math.round(r.current),
    Math.round(r.variance),
    r.valuationDate ? formatDate(r.valuationDate) : "",
    r.valuer,
  ]);

  return (
    <div className="space-y-5">
      <ReportNav className="print:hidden" />
      <PageHeader
        eyebrow="Reports"
        title="Asset Valuation Report"
        description={
          cur
            ? `Purchase vs. current value per asset — converted to ${selectedCode}.`
            : "Purchase vs. current value (latest recorded valuation) per asset, in each asset's own currency."
        }
        className="print:hidden"
        actions={
          <>
            {rows.length > 0 && (
              <CsvExportButton
                filename="asset-valuation.csv"
                headers={["S.No", "Code", "Name", "Location", "Cost Center", "Currency", "Purchase Value", "Current Value", "Variance", "Latest Valuation", "Valuer"]}
                rows={csvRows}
              />
            )}
            <PrintButton />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <ReportCountryFilter countries={countries} selected={country} currencyOptions={currencyOptions} />
        <ReportSelectFilter label="Cost center" param="cc" allLabel="All cost centers" options={costCenterOptions} selected={cc} />
        <ReportSelectFilter label="Currency" param="cur" allLabel="Original currency" options={currencyOptions} selected={cur} />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-right">S.No</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Cost center</TableHead>
              <TableHead className="text-right">Purchase value</TableHead>
              <TableHead className="text-right">Current value</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead>Latest valuation</TableHead>
              <TableHead>Valuer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={row.assetId}>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.location || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{row.costCenter || "—"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(row.symbol, row.purchase)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(row.symbol, row.current)}</TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${row.variance < 0 ? "text-destructive" : row.variance > 0 ? "text-success" : ""}`}
                >
                  {money(row.symbol, row.variance)}
                </TableCell>
                <TableCell>{row.valuationDate ? formatDate(row.valuationDate) : "—"}</TableCell>
                <TableCell>{row.valuer || "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  No assets match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {rows.length > 0 && (
            <tfoot className="border-t bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="font-medium">
                  Total{!cur && " (mixed currencies)"}
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{money(totalSymbol, totalPurchase)}</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{money(totalSymbol, totalCurrent)}</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{money(totalSymbol, totalCurrent - totalPurchase)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
