import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const statusVariant = {
  active: "success",
  inactive: "secondary",
  sold: "outline",
} as const;

export default async function AssetsPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: assetRows }, canCreate] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name, property_type, country, city, status, current_value")
      .eq("company_id", companyId)
      .order("asset_code"),
    hasPermission("assets", "create"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="text-sm text-muted-foreground">Registered rental properties and other assets.</p>
        </div>
        {canCreate && (
          <Button asChild size="sm">
            <Link href="/assets/new">New asset</Link>
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Property type</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Current value</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(assetRows ?? []).map((asset) => (
            <TableRow key={asset.id}>
              <TableCell>
                <Link href={`/assets/${asset.id}`} className="font-mono font-medium hover:underline">
                  {asset.asset_code}
                </Link>
              </TableCell>
              <TableCell>{asset.asset_name}</TableCell>
              <TableCell>{asset.property_type}</TableCell>
              <TableCell>
                {asset.city ? `${asset.city}, ` : ""}
                {asset.country}
              </TableCell>
              <TableCell>{asset.current_value?.toLocaleString() ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={statusVariant[asset.status as keyof typeof statusVariant]}>{asset.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
          {(assetRows ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No assets registered yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
