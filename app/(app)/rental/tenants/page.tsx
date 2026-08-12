import { Fragment } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UsersIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { formatDate, formatMoney } from "@/lib/format";
import { isRentOverdue } from "@/lib/rental/overdue";

// Tenants are the accounts under a Chart-of-Accounts tenant group. This page
// lists each tenant's lease(s) — the property let to them and its rent and
// outstanding dues — grouped by country.
export default async function TenantsPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: uaeLeases },
    { data: pkLeases },
    { data: tenants },
    { data: assets },
    { data: currencies },
    { data: invoices },
  ] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("id, tenant_id, asset_id, rental_amount, rent_cycle, lease_start, lease_end, currency_id")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    supabase
      .schema("rental")
      .from("pk_leases")
      .select("id, tenant_id, asset_id, monthly_rent, rent_cycle, lease_start, lease_end, currency_id")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    // Only tenants backed by a Chart-of-Accounts account (account_id set).
    supabase
      .schema("rental")
      .from("tenants")
      .select("id, name, account_id")
      .eq("company_id", companyId)
      .not("account_id", "is", null)
      .is("deleted_at", null),
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name, country")
      .eq("company_id", companyId),
    supabase.schema("core").from("currencies").select("id, code, symbol"),
    supabase
      .schema("rental")
      .from("v_rent_invoices")
      .select("lease_id, due_date, outstanding_amount")
      .eq("company_id", companyId)
      .gt("outstanding_amount", 0),
  ]);

  const tenantById = new Map((tenants ?? []).map((t) => [t.id as string, t]));
  const assetById = new Map((assets ?? []).map((a) => [a.id as string, a]));
  const symbolById = new Map((currencies ?? []).map((c) => [c.id as string, (c.symbol || c.code) as string]));

  // Outstanding rent per lease, split into due (through the due month) and
  // overdue (after the due month ends), following the app's overdue rule.
  const duesByLease = new Map<string, { due: number; overdue: number }>();
  for (const inv of invoices ?? []) {
    const k = inv.lease_id as string;
    if (!k) continue;
    const g = duesByLease.get(k) ?? { due: 0, overdue: 0 };
    const amt = Number(inv.outstanding_amount) || 0;
    if (isRentOverdue(inv.due_date as string, today)) g.overdue += amt;
    else g.due += amt;
    duesByLease.set(k, g);
  }

  type Row = {
    country: string;
    tenantName: string;
    property: string;
    periodStart: string | null;
    periodEnd: string | null;
    rent: number;
    cycle: string | null;
    symbol: string;
    due: number;
    overdue: number;
  };

  const rows: Row[] = [];
  const pushLease = (
    leaseId: string,
    tenantId: string,
    assetId: string,
    rent: number,
    cycle: string | null,
    start: string | null,
    end: string | null,
    currencyId: string | null,
  ) => {
    const tenant = tenantById.get(tenantId);
    if (!tenant) return; // not a CoA-backed tenant
    const asset = assetById.get(assetId);
    const dues = duesByLease.get(leaseId) ?? { due: 0, overdue: 0 };
    rows.push({
      country: asset?.country ?? "—",
      tenantName: tenant.name as string,
      property: asset ? `${asset.asset_code} ${asset.asset_name}` : "—",
      periodStart: start,
      periodEnd: end,
      rent: Number(rent) || 0,
      cycle,
      symbol: currencyId ? symbolById.get(currencyId) ?? "" : "",
      due: dues.due,
      overdue: dues.overdue,
    });
  };

  for (const l of uaeLeases ?? []) {
    pushLease(
      l.id as string,
      l.tenant_id as string,
      l.asset_id as string,
      Number(l.rental_amount),
      l.rent_cycle as string | null,
      l.lease_start as string | null,
      l.lease_end as string | null,
      l.currency_id as string | null,
    );
  }
  for (const l of pkLeases ?? []) {
    pushLease(
      l.id as string,
      l.tenant_id as string,
      l.asset_id as string,
      Number(l.monthly_rent),
      l.rent_cycle as string | null,
      l.lease_start as string | null,
      l.lease_end as string | null,
      l.currency_id as string | null,
    );
  }

  // Group by country, ordered with UAE (AE) first then PK, then others.
  const countryLabel: Record<string, string> = { AE: "United Arab Emirates", PK: "Pakistan" };
  const order = (c: string) => (c === "AE" ? 0 : c === "PK" ? 1 : 2);
  const byCountry = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byCountry.has(r.country)) byCountry.set(r.country, []);
    byCountry.get(r.country)!.push(r);
  }
  const groups = [...byCountry.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  for (const [, list] of groups) list.sort((a, b) => a.tenantName.localeCompare(b.tenantName));

  const money = (symbol: string, n: number) => (symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rental"
        title="Tenants"
        description="Tenants from the Chart of Accounts, with the property let to them and their rent dues, grouped by country."
      />

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No tenant leases yet"
            description="Tenants appear here once they hold a lease. Add tenants under a tenant group in Chart of Accounts and create their leases."
          />
        ) : (
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Tenant</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Rent Period</TableHead>
                <TableHead className="text-right">Rent Amount</TableHead>
                <TableHead className="text-right">Due Amount</TableHead>
                <TableHead className="text-right">Overdue Amount</TableHead>
                <TableHead className="text-right">Total Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(([country, list]) => (
                <Fragment key={country}>
                  <TableRow className="bg-ledger/10 hover:bg-ledger/10">
                    <TableCell colSpan={7} className="font-semibold text-foreground">
                      {countryLabel[country] ?? country}
                    </TableCell>
                  </TableRow>
                  {list.map((r, i) => (
                    <TableRow key={`${country}-${i}`}>
                      <TableCell className="font-medium">{r.tenantName}</TableCell>
                      <TableCell>{r.property}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.periodStart ? formatDate(r.periodStart) : "—"} — {r.periodEnd ? formatDate(r.periodEnd) : "—"}
                        {r.cycle ? <span className="ml-1 text-xs capitalize">({r.cycle})</span> : null}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(r.symbol, r.rent)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(r.symbol, r.due)}</TableCell>
                      <TableCell
                        className={`text-right font-mono tabular-nums ${r.overdue > 0 ? "text-destructive" : ""}`}
                      >
                        {money(r.symbol, r.overdue)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {money(r.symbol, r.due + r.overdue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
