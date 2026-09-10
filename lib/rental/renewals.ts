import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Which properties are let, which are standing empty, and when each contract
 * runs out.
 *
 * The two lease tables (UAE — HH included — and Pakistan) become ONE list, one
 * row per property, ordered by how soon it falls due. The dashboard draws it,
 * and the header bell and the daily push count it, all from this same rule, so
 * a property that is red on the dashboard is the property the alert is about.
 *
 * A property is read against today rather than against its newest contract, so a
 * contract signed to start later never hides what is true now.
 *
 * Vacancy is DECLARED, never inferred. A property counts as empty only when an
 * invoice line says it was — ticked Vacant for a period covering today — or when
 * it has never been let at all. A contract that has simply run out is a renewal
 * nobody has chased, which is a different thing and has its own band: the tenant
 * may well still be in the property while the paperwork catches up, and the
 * books cannot tell. Guessing there would put a property in the empty count that
 * nobody has said is empty.
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

/** The date `days` after (or, negative, before) the given one. */
export function addDays(date: string, days: number): string {
  return new Date(utcDay(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "MMM YYYY" for a date, used when a lease carries no explicit renewal month. */
function monthLabel(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(date ?? ""));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

/**
 * What a property's row means:
 * - `due` / `later` — under contract: let today, or signed to start shortly.
 *   This is how long that contract still runs.
 * - `overdue` — the contract ran out and nothing has been signed to follow it.
 *   A renewal nobody has chased; it does NOT claim the property is empty.
 * - `vacant` — declared empty: an invoice line ticked Vacant covers today, or
 *   the property has never been let.
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
  /** The property this row is about; there is one row per property. */
  assetId: string | null;
  /** Where the property is. HH lettings sit under the UAE, not on their own. */
  country: RenewalCountry;
  /** "HH" for a holiday-homes letting, else the plain country lease. */
  segment: "HH" | "UAE" | "PK";
  property: string;
  tenant: string;
  start: string | null;
  /**
   * The contract end the row is about: the last day of the running tenancy, or
   * of the one that ended when the property is empty. Null when never let.
   */
  end: string | null;
  /** The lease's own renewal month when set, else the month the contract ends. */
  renewLabel: string;
  /** Days to `end`; negative once it has passed, null when there is no contract. */
  daysLeft: number | null;
  status: RenewalStatus;
  /** How many active contracts the property carries. */
  contracts: number;

  // --- vacancy, stated as a period rather than left to be inferred ---
  /** True when the property is DECLARED empty today, or has never been let. */
  isVacant: boolean;
  /** First day of the declared vacancy. Null when the property was never let. */
  vacantFrom: string | null;
  /** Last empty day — null while the vacancy is still open-ended. */
  vacantTo: string | null;
  /** Days empty: to date when open-ended, or the whole gap when it is closed. */
  vacantDays: number | null;
  /** When the next tenancy starts, if one is already signed. */
  nextStart: string | null;
  /** Under contract, but that contract has not begun yet. */
  notStartedYet: boolean;
}

/** One lease as this module needs it, from either country's table. */
interface RawLease {
  id: string;
  assetId: string | null;
  tenantId: string | null;
  start: string | null;
  end: string;
  rentMonth: string | null;
  /** The line declares the property EMPTY for this period rather than letting it. */
  isVacant: boolean;
  source: "uae" | "pk";
  country: RenewalCountry;
  segment: LeaseRenewal["segment"];
}

/**
 * Every rental property, soonest renewal first, with vacant ones last.
 *
 * Leases with no end date are left out — there is nothing to renew on a date
 * that was never recorded — so a property whose only lease is open-ended reads
 * as never let.
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
      .select("id, asset_id, tenant_id, lease_start, lease_end, lease_type, rent_month, is_vacant")
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

  const leases: RawLease[] = [];
  for (const l of uaeLeases ?? []) {
    if (!l.lease_end) continue;
    leases.push({
      id: l.id as string,
      assetId: (l.asset_id as string | null) ?? null,
      tenantId: (l.tenant_id as string | null) ?? null,
      start: (l.lease_start as string | null) ?? null,
      end: l.lease_end as string,
      rentMonth: (l.rent_month as string | null) ?? null,
      isVacant: (l as { is_vacant?: boolean }).is_vacant === true,
      source: "uae",
      country: "AE",
      segment: l.lease_type === "hh" ? "HH" : "UAE",
    });
  }
  for (const l of pkLeases ?? []) {
    if (!l.lease_end) continue;
    leases.push({
      id: l.id as string,
      assetId: (l.asset_id as string | null) ?? null,
      tenantId: (l.tenant_id as string | null) ?? null,
      start: (l.lease_start as string | null) ?? null,
      end: l.lease_end as string,
      rentMonth: (l.rent_month as string | null) ?? null,
      // Pakistan leases carry no vacancy marking; the HH run is where it is used.
      isVacant: false,
      source: "pk",
      country: "PK",
      segment: "PK",
    });
  }

  const tenantIds = [...new Set(leases.map((l) => l.tenantId).filter((id): id is string => Boolean(id)))];
  const leaseAssetIds = [...new Set(leases.map((l) => l.assetId).filter((id): id is string => Boolean(id)))];
  const knownAssetIds = new Set((rentalAssets ?? []).map((a) => a.id as string));
  // A lease may sit on a property no longer flagged as rental; look those names
  // up too rather than showing a dash.
  const missingAssetIds = leaseAssetIds.filter((id) => !knownAssetIds.has(id));

  const [{ data: extraAssets }, { data: tenants }] = await Promise.all([
    missingAssetIds.length
      ? supabase.schema("assets").from("assets").select("id, asset_code, asset_name, country").in("id", missingAssetIds)
      : Promise.resolve({ data: [] as { id: string; asset_code: string; asset_name: string; country: string }[] }),
    tenantIds.length
      ? supabase.schema("rental").from("tenants").select("id, name").in("id", tenantIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const allAssets = [...(rentalAssets ?? []), ...(extraAssets ?? [])];
  const assetById = new Map(allAssets.map((a) => [a.id as string, a]));
  const tenantName = new Map((tenants ?? []).map((t) => [t.id as string, t.name as string]));

  const leasesByAsset = new Map<string, RawLease[]>();
  for (const l of leases) {
    // A lease with no property recorded can still be listed, standing alone.
    const key = l.assetId ?? `lease:${l.source}:${l.id}`;
    const arr = leasesByAsset.get(key) ?? [];
    arr.push(l);
    leasesByAsset.set(key, arr);
  }

  // Every rental property gets a row, whether it has ever been let or not.
  const keys = new Set<string>([...leasesByAsset.keys(), ...knownAssetIds]);
  const rows: LeaseRenewal[] = [];

  for (const key of keys) {
    const own = leasesByAsset.get(key) ?? [];
    const asset = assetById.get(key);

    // Lines that let the property, and lines that declare it empty. Only the
    // second kind makes a property vacant — see the note at the top of the file.
    const lets = own.filter((l) => !l.isVacant);
    const declaredVacant = own.filter((l) => l.isVacant);

    // Let today? A lease with no start date is treated as having always run.
    const current = lets
      .filter((l) => (l.start ?? "") <= asOf && asOf <= l.end)
      .sort((a, b) => b.end.localeCompare(a.end))[0];
    // The soonest tenancy still to begin, and the last one that has ended.
    const next = lets.filter((l) => l.start && l.start > asOf).sort((a, b) => a.start!.localeCompare(b.start!))[0];
    const ended = lets.filter((l) => l.end < asOf).sort((a, b) => b.end.localeCompare(a.end))[0];
    // A Vacant line covering today is the property SAYING it is empty.
    const vacantNow = declaredVacant
      .filter((l) => (l.start ?? "") <= asOf && asOf <= l.end)
      .sort((a, b) => b.end.localeCompare(a.end))[0];

    // The lease the row speaks for, and the term it runs to. Back-to-back
    // contracts extend one tenancy, so a let property's term is the LAST end
    // date on it — otherwise a property let for another year would look due.
    const subject = current ?? next ?? ended ?? vacantNow ?? own[0];
    // The term shown: to the last day of the running tenancy, of the one already
    // signed to start, or of the one that ended.
    const end = current
      ? lets.reduce((max, l) => (l.end > max ? l.end : max), current.end)
      : (next?.end ?? ended?.end ?? null);

    const country: RenewalCountry = subject?.country ?? normCountry((asset?.country as string | null) ?? null);
    // Empty only when it has been said so, or when the property has never been
    // let at all — a lapsed contract is a renewal to chase, not a vacancy.
    const neverLet = lets.length === 0 && !next;
    const isVacant = Boolean(vacantNow) || neverLet;
    // A declared vacancy carries its own dates; a property never let has none.
    const vacantFrom = vacantNow?.start ?? null;
    const vacantTo = vacantNow?.end ?? null;
    const vacantCountFrom = vacantFrom ?? (vacantTo ? asOf : null);
    const vacantDays = vacantCountFrom ? daysBetween(vacantCountFrom, vacantTo ?? asOf) + 1 : null;
    const daysLeft = end ? daysBetween(asOf, end) : null;

    rows.push({
      key: subject ? `${subject.source}:${subject.id}` : `asset:${key}`,
      source: subject?.source ?? (country === "PK" ? "pk" : "uae"),
      assetId: asset ? (asset.id as string) : (subject?.assetId ?? null),
      country,
      segment: subject?.segment ?? (country === "PK" ? "PK" : "UAE"),
      property: asset
        ? (asset.asset_name as string) || (asset.asset_code as string)
        : "—",
      tenant: (subject?.tenantId && tenantName.get(subject.tenantId)) || "—",
      start: subject?.start ?? null,
      end,
      renewLabel: monthLabel(subject?.rentMonth) || monthLabel(end),
      daysLeft,
      // Declared empty wins the row. Otherwise a property under contract — let
      // today, or signed to start — reads by how long that contract runs, and
      // one whose contract has simply run out is an overdue renewal.
      status: isVacant ? "vacant" : renewalStatusOf(daysLeft),
      contracts: lets.length,
      isVacant,
      vacantFrom,
      vacantTo,
      vacantDays,
      nextStart: next?.start ?? null,
      // Signed but not begun: the property is not let today and is not claimed
      // to be empty either — it is simply waiting for its tenancy to start.
      notStartedYet: !current && !isVacant && Boolean(next),
    });
  }

  rows.sort((a, b) => {
    if (a.daysLeft === null || b.daysLeft === null) {
      if (a.daysLeft !== b.daysLeft) return a.daysLeft === null ? 1 : -1;
      return a.property.localeCompare(b.property);
    }
    return a.daysLeft - b.daysLeft || a.property.localeCompare(b.property);
  });
  return rows;
}

/** The band a still-running contract falls in. */
function renewalStatusOf(daysLeft: number | null): RenewalStatus {
  if (daysLeft === null) return "vacant";
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= DUE_SOON_DAYS) return "due";
  return "later";
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

/** Properties earning nothing today, whatever the reason. */
export function vacantToday(rows: LeaseRenewal[]): LeaseRenewal[] {
  return rows.filter((r) => r.isVacant);
}
