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

export default async function HhLeasesPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: leases }, canCreate] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_leases")
      .select(
        "id, asset_id, lease_start, lease_end, rental_amount, rent_cycle, status, document_no, document_date, tenants:tenant_id(name)",
      )
      .eq("company_id", companyId)
      .eq("lease_type", "hh")
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
    document_no: string | null;
    document_date: string | null;
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

  const newButton = canCreate && (
    <Button asChild size="sm">
      <Link href="/rental/uae/hh-lease/new">
        <PlusIcon /> New HH lease
      </Link>
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="HH Leases"
        description="Multi-asset UAE (HH) leases — one tenant, many properties under a shared document number."
        actions={newButton}
      />

      <div className="rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={KeyRoundIcon}
            title="No HH leases yet"
            description="Create an HH lease to see it here."
            action={newButton}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Doc No</TableHead>
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
                    <TableCell className="font-mono text-xs text-muted-foreground">{lease.document_no ?? "—"}</TableCell>
                    <TableCell>
                      <Link href={`/rental/uae/leases/${lease.id}`} className="font-medium text-primary hover:underline">
                        {asset ? `${asset.asset_code} — ${asset.asset_name}` : "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{lease.tenants?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(lease.lease_start)} – {formatDate(lease.lease_end)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(lease.rental_amount)}</TableCell>
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
