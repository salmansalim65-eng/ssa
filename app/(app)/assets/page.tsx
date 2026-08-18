import { Fragment } from "react";
import Link from "next/link";
import { HomeIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssetFilters } from "@/components/assets/asset-filters";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { formatArea, areaUnitLabel } from "@/lib/assets/area-units";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

const statusVariant = {
  active: "success",
  inactive: "secondary",
  sold: "outline",
} as const;

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  const sp = await searchParams;
  const countryFilter = sp.country ?? "";

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  let assetQuery = supabase
    .schema("assets")
    .from("assets")
    .select(
      "id, asset_code, asset_name, property_type, country, city, official_owner, area_sqft, area_unit, current_value, currency_id, status",
    )
    .eq("company_id", companyId);
  if (countryFilter) assetQuery = assetQuery.eq("country", countryFilter);

  const [{ data: assetRows }, { data: countries }, { data: currencyRows }] = await Promise.all([
    assetQuery.order("asset_code"),
    supabase
      .schema("core")
      .from("countries")
      .select("code, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase.schema("core").from("currencies").select("id, code, symbol"),
  ]);

  const rows = assetRows ?? [];
  const countryList = countries ?? [];
  const nameByCode = new Map(countryList.map((c) => [c.code, c.name] as const));
  const countryName = (code: string) => nameByCode.get(code) ?? code;

  // Currency symbol/code per asset so amounts read e.g. "Rs 200,000,000" / "SR 4,000,000".
  const symbolById = new Map((currencyRows ?? []).map((c) => [c.id, c.symbol || c.code] as const));
  const codeById = new Map((currencyRows ?? []).map((c) => [c.id, c.code] as const));
  const money = (value: number, currencyId: string | null | undefined) => {
    const sym = currencyId ? symbolById.get(currencyId) : undefined;
    return `${sym ? `${sym} ` : ""}${formatMoney(value)}`;
  };

  // Group assets by country, ordered by country name; each group carries its own
  // Current Value subtotal. No cross-country grand total — countries can use
  // different currencies, so a combined sum would be meaningless.
  const groups = new Map<string, typeof rows>();
  for (const a of rows) {
    if (!groups.has(a.country)) groups.set(a.country, []);
    groups.get(a.country)!.push(a);
  }
  const groupKeys = [...groups.keys()].sort((x, y) => countryName(x).localeCompare(countryName(y)));

  const sumCurrent = (list: typeof rows) => list.reduce((s, a) => s + (a.current_value ?? 0), 0);
  // The subtotal's currency: the group's single currency, or null when mixed.
  const groupCurrency = (list: typeof rows) => {
    const ids = new Set(list.map((a) => a.currency_id).filter(Boolean));
    return ids.size === 1 ? ([...ids][0] as string) : null;
  };

  // CSV export mirrors the on-screen data (in country-group order), with an
  // explicit Country column since a flat file has no group headings.
  const csvRows = groupKeys.flatMap((code) =>
    groups.get(code)!.map((a) => [
      countryName(code),
      a.asset_code,
      a.asset_name,
      a.official_owner ?? "",
      a.area_sqft ?? "",
      areaUnitLabel(a.area_unit),
      a.current_value ?? "",
      a.currency_id ? codeById.get(a.currency_id) ?? "" : "",
      a.status,
    ]),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="Asset Register"
        description="Registered rental properties and other assets, grouped by country."
        className="print:hidden"
        actions={
          <>
            {rows.length > 0 && (
              <CsvExportButton
                filename={`asset-register${countryFilter ? `-${countryFilter}` : ""}.csv`}
                headers={[
                  "Country",
                  "Code",
                  "Name",
                  "Official Owner",
                  "Area",
                  "Area Unit",
                  "Current Value",
                  "Currency",
                  "Status",
                ]}
                rows={csvRows}
              />
            )}
            <PrintButton />
          </>
        }
      />

      {/* Title shown only on the printout / PDF (the page header is hidden then). */}
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">Asset Register</h1>
        <p className="text-sm text-muted-foreground">
          {countryFilter ? countryName(countryFilter) : "All countries"}
        </p>
      </div>

      <AssetFilters countries={countryList} selectedCountry={countryFilter} />

      <div className="rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={HomeIcon}
            title={countryFilter ? "No assets in this country" : "No assets registered yet"}
            description={
              countryFilter
                ? "Try a different country filter."
                : "Add a property under the PROPERTIES group in Chart of Accounts — it appears here automatically."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Official owner</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead className="text-right">Current Value</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupKeys.map((code) => {
                  const list = groups.get(code)!;
                  return (
                    <Fragment key={code}>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={5} className="font-semibold">
                          {countryName(code)}
                          <span className="ml-2 font-normal text-muted-foreground">
                            ({list.length} asset{list.length === 1 ? "" : "s"})
                          </span>
                        </TableCell>
                      </TableRow>
                      {list.map((asset) => (
                        <TableRow key={asset.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/assets/${asset.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {asset.asset_name}
                            </Link>
                          </TableCell>
                          <TableCell>{asset.official_owner ?? "—"}</TableCell>
                          <TableCell>{formatArea(asset.area_sqft, asset.area_unit)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {asset.current_value != null ? money(asset.current_value, asset.currency_id) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={statusVariant[asset.status as keyof typeof statusVariant]}
                              className="capitalize"
                            >
                              {asset.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t bg-ledger/10 hover:bg-ledger/10">
                        <TableCell colSpan={4} className="text-right font-semibold text-ledger">
                          {countryName(code)} total
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold tabular-nums">
                          {money(sumCurrent(list), groupCurrency(list))}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
