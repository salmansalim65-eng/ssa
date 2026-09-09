import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Which leases are running out, and when.
 *
 * Every active lease — UAE (including HH) and Pakistan alike — carries an end
 * date, and that date is also the day the contract has to be renewed. This
 * module turns the two lease tables into one list ordered by how soon each
 * contract falls due, so the dashboard can draw it and the header bell and the
 * daily push can count it. All three read the SAME rule, so a lease that is red
 * on the dashboard is the lease the alert is about.
 *
 * Dates are plain calendar strings (`YYYY-MM-DD`) throughout and day arithmetic
 * is done in UTC, so a server in another time zone never shifts a contract into
 * the wrong day.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` date as a UTC timestamp. */
export function utcDay(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

/** Whole days from `from` to `to` (negative when `to` is already past). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

/** "MMM YYYY" for a date, used when a lease carries no explicit renewal month. */
function monthLabel(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(date ?? ""));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

/**
 * How urgent a renewal is. The bands are what the colours mean:
 * `overdue` the contract has already ended — which also means the property is
 * standing empty today — `due` it ends within a month, `later` there is still
 * time, and `vacant` the property carries no contract at all.
 */
export type RenewalStatus = "overdue" | "due" | "later" | "vacant";

/** A renewal is "due" once it is this close, and the alert counts it from here. */
export const DUE_SOON_DAYS = 30;

/** The two countries the business lets in. HH is a UAE letting, not a country. */
export type RenewalCountry = "AE" | "PK";

export const COUNTRY_LABEL: Record<RenewalCountry, string> = { AE: "UAE", PK: "Pakistan" };

export interface LeaseRenewal {
  key: string;
  source: "uae" | "pk";
  /** The property this contract is on; the row is one per property. */
  assetId: string | null;
  /** Where the property is. HH lettings sit under the UAE, not on their own. */
  country: RenewalCountry;
  /** "HH" for a holiday-homes letting, else the plain country lease. */
  segment: "HH" | "UAE" | "PK";
  property: string;
  tenant: string;
  start: string | null;
  /** Contract end — also the day it must be renewed. Null when there is none. */
  end: string | null;
  /** The lease's own renewal month when set, else the month the contract ends. */
  renewLabel: string;
  /** Days to the end date; negative once ended, null with no contract at all. */
  daysLeft: number | null;
  status: RenewalStatus;
  /** How many active contracts the property carries, this one included. */
  contracts: number;
}

export function renewalStatus(daysLeft: number | null): RenewalStatus {
  if (daysLeft === null) return "vacant";
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= DUE_SOON_DAYS) return "due";
  return "later";
}

/**
 * Every rental property, soonest renewal first.
 *
 * A property with a running contract carries its end date; one with no contract
 * at all is listed as vacant at the bottom, because a property earning nothing
 * belongs in a renewal report as much as one about to expire. Leases with no end
 * date are left out — there is nothing to renew on a date that was never
 * recorded — so a property whose only lease is open-ended reads as vacant.
 */
export async function loadLeaseRenewals(
  supabase: SupabaseClient<Database>,
  companyId: string,
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<LeaseRenewal[]> {
  const [{ data: uaeLeases }, { data: pkLeases }, { data: rentalAssets }] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("id, asset_id, tenant_id, lease_start, lease_end, lease_type, rent_month")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null),
    supabase
      .schema("rental")
      .from("pk_leases")
      .select("id, asset_id, tenant_id, lease_start, lease_end, rent_month")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null),
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name, country")
      .eq("company_id", companyId)
      .eq("is_rental", true)
      .is("deleted_at", null),
  ]);

  const assetIds = [...uaeLeases ?? [], ...pkLeases ?? []]
    .map((l) => l.asset_id as string | null)
    .filter((id): id is string => Boolean(id));
  const tenantIds = [...uaeLeases ?? [], ...pkLeases ?? []]
    .map((l) => l.tenant_id as string | null)
    .filter((id): id is string => Boolean(id));

  const [{ data: assets }, { data: tenants }] = await Promise.all([
    assetIds.length
      ? supabase.schema("assets").from("assets").select("id, asset_code, asset_name").in("id", [...new Set(assetIds)])
      : Promise.resolve({ data: [] as { id: string; asset_code: string; asset_name: string }[] }),
    tenantIds.length
      ? supabase.schema("rental").from("tenants").select("id, name").in("id", [...new Set(tenantIds)])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const assetName = new Map((assets ?? []).map((a) => [a.id as string, (a.asset_name as string) || (a.asset_code as string)]));
  const tenantName = new Map((tenants ?? []).map((t) => [t.id as string, t.name as string]));

  const rows: LeaseRenewal[] = [];
  const push = (
    source: "uae" | "pk",
    country: RenewalCountry,
    segment: LeaseRenewal["segment"],
    lease: { id: unknown; asset_id: unknown; tenant_id: unknown; lease_start: unknown; lease_end: unknown; rent_month: unknown },
  ) => {
    const end = (lease.lease_end as string | null) ?? null;
    if (!end) return;
    const daysLeft = daysBetween(asOf, end);
    rows.push({
      key: `${source}:${lease.id as string}`,
      source,
      assetId: (lease.asset_id as string | null) ?? null,
      country,
      segment,
      property: assetName.get(lease.asset_id as string) ?? "—",
      tenant: tenantName.get(lease.tenant_id as string) ?? "—",
      start: (lease.lease_start as string | null) ?? null,
      end,
      renewLabel: (lease.rent_month as string | null) || monthLabel(end),
      daysLeft,
      status: renewalStatus(daysLeft),
      contracts: 1,
    });
  };

  for (const l of uaeLeases ?? []) push("uae", "AE", l.lease_type === "hh" ? "HH" : "UAE", l);
  for (const l of pkLeases ?? []) push("pk", "PK", "PK", l);

  // One row per PROPERTY, not per contract. A property is often let on several
  // active contracts at once — back-to-back periods for the same tenant, or a
  // run of short HH stays — and it is the LAST of them that says when the
  // property actually falls due for renewal. Keeping the earliest would raise a
  // renewal alarm on a property that is still let for months.
  const byProperty = new Map<string, LeaseRenewal>();
  for (const row of rows) {
    // A lease with no property recorded can only stand for itself.
    const key = row.assetId ?? `lease:${row.key}`;
    const kept = byProperty.get(key);
    if (!kept) {
      byProperty.set(key, row);
      continue;
    }
    const winner = (row.end ?? "") > (kept.end ?? "") ? row : kept;
    byProperty.set(key, { ...winner, contracts: kept.contracts + 1 });
  }

  // A rental property with no running contract is vacant. It has no date to sort
  // by, so it sits after everything that does.
  for (const a of rentalAssets ?? []) {
    const id = a.id as string;
    if (byProperty.has(id)) continue;
    const country: RenewalCountry = normCountry(a.country as string | null);
    byProperty.set(id, {
      key: `asset:${id}`,
      source: country === "PK" ? "pk" : "uae",
      assetId: id,
      country,
      segment: country === "PK" ? "PK" : "UAE",
      property: (a.asset_name as string) || (a.asset_code as string),
      tenant: "—",
      start: null,
      end: null,
      renewLabel: "",
      daysLeft: null,
      status: "vacant",
      contracts: 0,
    });
  }

  const collapsed = [...byProperty.values()];
  collapsed.sort((a, b) => {
    if (a.daysLeft === null || b.daysLeft === null) {
      if (a.daysLeft !== b.daysLeft) return a.daysLeft === null ? 1 : -1;
      return a.property.localeCompare(b.property);
    }
    return a.daysLeft - b.daysLeft || a.property.localeCompare(b.property);
  });
  return collapsed;
}

/**
 * The two country codes are written both ways across the app ("AE"/"UAE",
 * "PK"/"PAK"), so fold every spelling before a property is filed under one.
 * Anything else — a Saudi holding, say — is filed under the UAE books it is
 * managed from rather than dropped from the list.
 */
function normCountry(country: string | null): RenewalCountry {
  const u = (country ?? "").trim().toUpperCase();
  return u === "PK" || u === "PAK" || u === "PAKISTAN" ? "PK" : "AE";
}

/** Contracts needing attention now: already ended, or ending within the month. */
export function renewalsNeedingAttention(rows: LeaseRenewal[]): LeaseRenewal[] {
  return rows.filter((r) => r.status === "overdue" || r.status === "due");
}

/**
 * Properties earning nothing today: the ones whose contract has run out, plus
 * the ones that never had one. Both are empty; they differ only in whether
 * there is a contract to renew.
 */
export function vacantToday(rows: LeaseRenewal[]): LeaseRenewal[] {
  return rows.filter((r) => r.status === "overdue" || r.status === "vacant");
}
