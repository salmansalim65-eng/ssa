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

  const [{ data: leases }, { data: invoices }, canCreate] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("id, asset_id, lease_start, lease_end, rental_amount, rent_cycle, status, document_no, tenants:tenant_id(name)")
      .eq("company_id", companyId)
      .or("lease_type.is.null,lease_type.neq.hh")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    // The combined invoice per voucher, so a row opens its grid.
    supabase
      .schema("rental")
      .from("uae_rent_invoices")
      .select("id, lease_id")
      .eq("company_id", companyId)
      .eq("invoice_type", "UAE"),
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

  // Map each voucher (document_no) to its combined invoice so any of its lease
  // rows opens the same grid it was created in.
  const docByLease = new Map(rows.map((r) => [r.id, r.document_no] as const));
  const invoiceByDoc = new Map<string, string>();
  for (const inv of (invoices as { id: string; lease_id: string }[]) ?? []) {
    const doc = docByLease.get(inv.lease_id);
    if (doc) invoiceByDoc.set(doc, inv.id);
  }

  const newButton = canCreate && (
    <Button asChild size="sm">
      <Link href="/rental/uae/leases/new">
        <PlusIcon /> New UAE Rent Invoice
      </Link>
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="UAE Rent Invoices"
        description="Monthly or yearly rent cycles for UAE properties."
        actions={newButton}
      />

      <div className="rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={KeyRoundIcon}
            title="No UAE Rent Invoices yet"
            description="Create a UAE Rent Invoice to see it here."
            action={newButton}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Asset</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Term</TableHead>
                <TableHead className="text-right">Rent</TableHead>
                <TableHead className="text-right">Management (5%)</TableHead>
                <TableHead className="text-right">Net Rent</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lease) => {
                const asset = assetsById.get(lease.asset_id) ?? null;
                // Open the invoice in the grid it was created in; fall back to the
                // lease detail for legacy single leases with no combined invoice.
                const invId = lease.document_no ? invoiceByDoc.get(lease.document_no) : undefined;
                const href = invId ? `/rental/uae/invoices/${invId}/edit` : `/rental/uae/leases/${lease.id}`;
                const rent = Number(lease.rental_amount) || 0;
                const management = Math.round(rent * 0.05 * 100) / 100;
                const netRent = Math.round((rent - management) * 100) / 100;
                return (
                  <TableRow key={lease.id}>
                    <TableCell>
                      <Link href={href} className="font-medium text-primary hover:underline">
                        {asset ? asset.asset_name : "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{lease.tenants?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(lease.lease_start)} – {formatDate(lease.lease_end)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(rent)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatMoney(management)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-medium">{formatMoney(netRent)}</TableCell>
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
