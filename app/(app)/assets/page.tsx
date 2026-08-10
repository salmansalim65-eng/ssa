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
      "id, asset_code, asset_name, property_type, country, city, official_owner, area_sqft, area_unit, current_value, total_property_value, status",
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

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="Asset Register"
        description="Registered rental properties and other assets."
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
                  <TableHead>Country</TableHead>
                  <TableHead>Official owner</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead className="text-right">Current Value</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((asset) => (
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
                    <TableCell>{nameByCode.get(asset.country) ?? asset.country}</TableCell>
                    <TableCell>{asset.official_owner ?? "—"}</TableCell>
                    <TableCell>{formatArea(asset.area_sqft, asset.area_unit)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {asset.current_value != null ? formatMoney(asset.current_value) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {asset.total_property_value != null ? formatMoney(asset.total_property_value) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[asset.status as keyof typeof statusVariant]} className="capitalize">
                        {asset.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
