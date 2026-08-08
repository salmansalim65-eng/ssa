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
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

const statusVariant = {
  active: "success",
  inactive: "secondary",
  sold: "outline",
} as const;

export default async function AssetsPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: assetRows }, canCreate] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name, property_type, country, city, status, current_value")
      .eq("company_id", companyId)
      .order("asset_code"),
    hasPermission("assets", "create"),
  ]);

  const rows = assetRows ?? [];

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

      <div className="rounded-xl border bg-card shadow-sm">
        {rows.length === 0 ? (
          <EmptyState
            icon={HomeIcon}
            title="No assets registered yet"
            description="Register a property or asset to start tracking it here."
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
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Property type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Current Value</TableHead>
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
                  <TableCell>{asset.property_type}</TableCell>
                  <TableCell>
                    {asset.city ? `${asset.city}, ` : ""}
                    {asset.country}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {asset.current_value != null ? formatMoney(asset.current_value) : "—"}
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
        )}
      </div>
    </div>
  );
}
