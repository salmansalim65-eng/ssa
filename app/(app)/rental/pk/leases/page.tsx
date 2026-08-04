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
import { fetchRefs } from "@/lib/supabase/hydrate";

const statusVariant = { active: "success", expired: "secondary", terminated: "destructive" } as const;

export default async function PkLeasesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: leases }, canCreate] = await Promise.all([
    supabase
      .schema("rental")
      .from("pk_leases")
      .select("id, asset_id, lease_start, lease_end, monthly_rent, status, tenants:tenant_id(name)")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    hasPermission("pk_rent_invoice", "create"),
  ]);

  type RawRow = {
    id: string;
    asset_id: string;
    lease_start: string;
    lease_end: string;
    monthly_rent: number;
    status: keyof typeof statusVariant;
    tenants: { name: string } | null;
  };

  const rows = (leases as unknown as RawRow[]) ?? [];
  const assetsById = await fetchRefs<{ id: string; asset_code: string; asset_name: string }>(
    supabase,
    "assets",
    "assets",
    "asset_code, asset_name",
    rows.map((r) => r.asset_id),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pakistan Leases</h1>
          <p className="text-sm text-muted-foreground">Monthly rent cycles for Pakistan properties.</p>
        </div>
        {canCreate && (
          <Button asChild size="sm">
            <Link href="/rental/pk/leases/new">New lease</Link>
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Term</TableHead>
            <TableHead>Monthly rent</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((lease) => {
            const asset = assetsById.get(lease.asset_id) ?? null;
            return (
              <TableRow key={lease.id}>
                <TableCell>
                  <Link href={`/rental/pk/leases/${lease.id}`} className="font-medium hover:underline">
                    {asset ? `${asset.asset_code} — ${asset.asset_name}` : "—"}
                  </Link>
                </TableCell>
                <TableCell>{lease.tenants?.name ?? "—"}</TableCell>
                <TableCell>
                  {lease.lease_start} – {lease.lease_end}
                </TableCell>
                <TableCell>{lease.monthly_rent.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant[lease.status]}>{lease.status}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No leases yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
