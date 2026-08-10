import { Fragment } from "react";
import Link from "next/link";
import { HomeIcon, PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { formatArea } from "@/lib/assets/area-units";
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
      "id, asset_code, asset_name, property_type, country, city, official_owner, area_sqft, area_unit, current_value, status",
    )
    .eq("company_id", companyId);
  if (countryFilter) assetQuery = assetQuery.eq("country", countryFilter);

  const [{ data: assetRows }, { data: countries }, canCreate] = await Promise.all([
    assetQuery.order("asset_code"),
    supabase
      .schema("core")
      .from("countries")
      .select("code, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    hasPermission("assets", "create"),
  ]);

  const rows = assetRows ?? [];
  const countryList = countries ?? [];
  const nameByCode = new Map(countryList.map((c) => [c.code, c.name] as const));
  const countryName = (code: string) => nameByCode.get(code) ?? code;

  // Group assets by country, ordered by country name; each group carries its own
  // Current Value / Total Value subtotals, plus a grand total across all.
  const groups = new Map<string, typeof rows>();
  for (const a of rows) {
    if (!groups.has(a.country)) groups.set(a.country, []);
    groups.get(a.country)!.push(a);
  }
  const groupKeys = [...groups.keys()].sort((x, y) => countryName(x).localeCompare(countryName(y)));

  const sumCurrent = (list: typeof rows) => list.reduce((s, a) => s + (a.current_value ?? 0), 0);
  const grandCurrent = sumCurrent(rows);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="Asset Register"
        description="Registered rental properties and other assets, grouped by country."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/assets/new">
                <PlusIcon /> New asset
              </Link>
            </Button>
          )
        }
      />

      <AssetFilters countries={countryList} selectedCountry={countryFilter} />

      <div className="rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={HomeIcon}
            title={countryFilter ? "No assets in this country" : "No assets registered yet"}
            description={
              countryFilter
                ? "Try a different country filter, or register a new asset."
                : "Register a property or asset to start tracking it here."
            }
            action={
              canCreate && (
                <Button asChild>
                  <Link href="/assets/new">
                    <PlusIcon /> New asset
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Code</TableHead>
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
                        <TableCell colSpan={6} className="font-semibold">
                          {countryName(code)}
                          <span className="ml-2 font-normal text-muted-foreground">
                            ({list.length} asset{list.length === 1 ? "" : "s"})
                          </span>
                        </TableCell>
                      </TableRow>
                      {list.map((asset) => (
                        <TableRow key={asset.id}>
                          <TableCell>
                            <Link
                              href={`/assets/${asset.id}`}
                              className="font-mono font-medium text-primary hover:underline"
                            >
                              {asset.asset_code}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium">{asset.asset_name}</TableCell>
                          <TableCell>{asset.official_owner ?? "—"}</TableCell>
                          <TableCell>{formatArea(asset.area_sqft, asset.area_unit)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {asset.current_value != null ? formatMoney(asset.current_value) : "—"}
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
                      <TableRow className="border-t hover:bg-transparent">
                        <TableCell colSpan={4} className="text-right font-medium text-muted-foreground">
                          {countryName(code)} total
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {formatMoney(sumCurrent(list))}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </Fragment>
                  );
                })}

                <TableRow className="border-t-2 bg-ledger/10 hover:bg-ledger/10">
                  <TableCell colSpan={4} className="text-right font-semibold uppercase tracking-wide text-ledger">
                    All countries total
                  </TableCell>
                  <TableCell className="text-right font-mono text-base font-bold tabular-nums">
                    {formatMoney(grandCurrent)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
