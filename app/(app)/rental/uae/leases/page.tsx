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
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

const statusVariant = { active: "success", expired: "secondary", terminated: "destructive" } as const;

export default async function UaeLeasesPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: leases }, canCreate] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("id, asset_id, lease_start, lease_end, rental_amount, rent_cycle, status, tenants:tenant_id(name)")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    hasPermission("uae_rent_invoice", "create"),
  ]);

  type RawRow = {
    id: string;
    asset_id: string;
    lease_start: string;
    lease_end: string;
    rental_amount: number;
    rent_cycle: string;
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
        title="UAE Leases"
        description="Monthly or yearly rent cycles for UAE properties."
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link href="/rental/uae/leases/new">
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
            description="Create a UAE lease to see it here."
            action={
              canCreate && (
                <Button asChild size="sm">
                  <Link href="/rental/uae/leases/new">
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
                <TableHead className="text-right">Rent</TableHead>
                <TableHead>Cycle</TableHead>
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
                        href={`/rental/uae/leases/${lease.id}`}
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
                      {formatMoney(lease.rental_amount)}
                    </TableCell>
                    <TableCell className="capitalize">{lease.rent_cycle}</TableCell>
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
