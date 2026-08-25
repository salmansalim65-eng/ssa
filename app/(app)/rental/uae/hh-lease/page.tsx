import { Fragment } from "react";
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The rent month a line bills for, taken from its lease start (yyyy-mm-dd).
// Parsed by hand to avoid any timezone shift from `new Date()`.
function rentMonthLabel(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [y, m] = isoDate.split("-");
  const mi = Number(m) - 1;
  if (!y || mi < 0 || mi > 11) return "—";
  return `${MONTHS[mi]} ${y}`;
}

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

  // Group lease lines by their voucher (document_no) so each voucher renders its
  // asset lines followed by a subtotal row. First-seen order is kept (rows are
  // already newest-first); lines with no document number stand on their own.
  const groups: { docNo: string | null; lines: RawRow[] }[] = [];
  const groupIndex = new Map<string, number>();
  for (const r of rows) {
    const key = r.document_no ?? `__${r.id}`;
    const gi = groupIndex.get(key);
    if (gi === undefined) {
      groupIndex.set(key, groups.length);
      groups.push({ docNo: r.document_no, lines: [r] });
    } else {
      groups[gi].lines.push(r);
    }
  }

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
                <TableHead>Rent Month</TableHead>
                <TableHead className="text-right">Rent</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const total = group.lines.reduce((sum, l) => sum + Number(l.rental_amount || 0), 0);
                return (
                  <Fragment key={group.docNo ?? group.lines[0].id}>
                    {group.lines.map((lease) => {
                      const asset = assetsById.get(lease.asset_id) ?? null;
                      return (
                        <TableRow key={lease.id}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{lease.document_no ?? "—"}</TableCell>
                          <TableCell>
                            <Link href={`/rental/uae/leases/${lease.id}`} className="font-medium text-primary hover:underline">
                              {asset ? asset.asset_name : "—"}
                            </Link>
                          </TableCell>
                          <TableCell>{lease.tenants?.name ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(lease.lease_start)} – {formatDate(lease.lease_end)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{rentMonthLabel(lease.lease_start)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatMoney(lease.rental_amount)}</TableCell>
                          <TableCell className="capitalize">{lease.rent_cycle}</TableCell>
                          <TableCell>
                            <Badge variant={statusVariant[lease.status]}>{lease.status}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {group.lines.length > 1 && (
                      <TableRow className="border-b-2 bg-muted/50 font-semibold hover:bg-muted/50">
                        <TableCell className="font-mono text-xs text-muted-foreground">{group.docNo ?? "—"}</TableCell>
                        <TableCell colSpan={4} className="text-right text-muted-foreground">
                          Voucher total ({group.lines.length} assets)
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatMoney(total)}</TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
