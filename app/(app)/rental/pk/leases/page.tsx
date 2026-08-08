import Link from "next/link";
import { KeyRoundIcon, PlusIcon } from "lucide-react";

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
import { fetchRefs } from "@/lib/supabase/hydrate";
import { formatDate, formatMoney } from "@/lib/format";

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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="Pakistan Leases"
        description="Monthly rent cycles for Pakistan properties."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/rental/pk/leases/new">
                <PlusIcon /> New lease
              </Link>
            </Button>
          )
        }
      />

      <div className="rounded-xl border bg-card shadow-sm">
        {rows.length === 0 ? (
          <EmptyState
            icon={KeyRoundIcon}
            title="No leases yet"
            description="Create a lease to start a monthly rent cycle."
            action={
              canCreate && (
                <Button asChild>
                  <Link href="/rental/pk/leases/new">
                    <PlusIcon /> New lease
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Asset</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Term</TableHead>
                <TableHead className="text-right">Monthly rent</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lease) => {
                const asset = assetsById.get(lease.asset_id) ?? null;
                return (
                  <TableRow key={lease.id}>
                    <TableCell>
                      <Link
                        href={`/rental/pk/leases/${lease.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {asset ? `${asset.asset_code} — ${asset.asset_name}` : "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{lease.tenants?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(lease.lease_start)} – {formatDate(lease.lease_end)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(lease.monthly_rent)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[lease.status]}>{lease.status}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
