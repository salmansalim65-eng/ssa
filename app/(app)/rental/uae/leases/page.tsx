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
function rentMonthLabel(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [y, m] = isoDate.split("-");
  const mi = Number(m) - 1;
  if (!y || mi < 0 || mi > 11) return "—";
  return `${MONTHS[mi]} ${y}`;
}

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
    supabase
      .schema("rental")
      .from("uae_rent_invoices")
      .select("id, lease_id, amount")
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

  // One row per voucher (document_no); leases with no document number stand alone.
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

  const docByLease = new Map(rows.map((r) => [r.id, r.document_no] as const));
  const invoiceByDoc = new Map<string, string>();
  const amountByDoc = new Map<string, number>();
  for (const inv of (invoices as { id: string; lease_id: string; amount: number }[]) ?? []) {
    const doc = docByLease.get(inv.lease_id);
    if (doc) {
      invoiceByDoc.set(doc, inv.id);
      amountByDoc.set(doc, Number(inv.amount));
    }
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
        description="One tenant, one or many properties per voucher — posted as a single rent invoice."
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
                <TableHead>Doc No</TableHead>
                <TableHead>Properties</TableHead>
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
                const first = group.lines[0];
                const total = group.docNo && amountByDoc.has(group.docNo)
                  ? amountByDoc.get(group.docNo)!
                  : group.lines.reduce((sum, l) => sum + Number(l.rental_amount || 0), 0);
                const firstAsset = assetsById.get(first.asset_id) ?? null;
                const count = group.lines.length;
                const propLabel = count > 1
                  ? `${firstAsset?.asset_name ?? "—"} +${count - 1} more`
                  : firstAsset?.asset_name ?? "—";
                const start = group.lines.reduce((m, l) => (l.lease_start < m ? l.lease_start : m), first.lease_start);
                const end = group.lines.reduce((m, l) => (l.lease_end > m ? l.lease_end : m), first.lease_end);
                const invId = group.docNo ? invoiceByDoc.get(group.docNo) : undefined;
                const href = invId ? `/rental/uae/invoices/${invId}/edit` : `/rental/uae/leases/${first.id}`;
                return (
                  <TableRow key={group.docNo ?? first.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{group.docNo ?? "—"}</TableCell>
                    <TableCell>
                      <Link href={href} className="font-medium text-primary hover:underline">
                        {propLabel}
                      </Link>
                    </TableCell>
                    <TableCell>{first.tenants?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(start)} – {formatDate(end)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{rentMonthLabel(start)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(total)}</TableCell>
                    <TableCell className="capitalize">{first.rent_cycle}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[first.status]}>{first.status}</Badge>
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
