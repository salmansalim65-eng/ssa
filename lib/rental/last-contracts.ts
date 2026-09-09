import "server-only";

import { createClient } from "@/lib/supabase/server";
import { addDays, daysBetween } from "@/lib/rental/renewals";

/**
 * What a property was last let on, and what its renewal would look like.
 *
 * A renewal is the same contract again: the same tenant, the same rent, the same
 * terms, one period later. Re-keying all of that from the old paper is where
 * mistakes come from — a rent typed a digit short, a start date a month out — so
 * picking the property brings its last contract back and the form starts from
 * the terms that are actually in force.
 *
 * Nothing here decides anything: it fills a form the user still edits and saves.
 */

/** Average days in a month, for reading a term's length back as months. */
const DAYS_PER_MONTH = 30.44;

/** The same day and month, `years` later; 29 February lands on the 28th. */
function addYears(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) + years;
  const month = date.slice(5, 7);
  const day = Number(date.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, Number(month), 0)).getUTCDate();
  return `${year}-${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export interface LastContract {
  /** The document the terms came from, so the form can say where they are from. */
  documentNo: string | null;
  /** The tenant's chart-of-accounts id — what the lease forms submit. */
  tenantAccountId: string | null;
  tenantName: string | null;
  start: string;
  end: string;
  /** Monthly rent as the form takes it. */
  rentalAmount: number;
  officialRent: number | null;
  securityDeposit: number;
  rentCycle: "monthly" | "yearly";
  paymentTerms: "advance" | "monthly" | "quarterly" | "half_yearly" | "yearly";
  currencyId: string | null;
  expenses: { accountId: string; amount: number }[];
  /** The renewal this suggests: the day after the old term, for as long again. */
  nextStart: string;
  nextEnd: string;
}

/** The last day of the month `months` after `date`'s month, keeping the day. */
function addMonths(date: string, months: number): string {
  const total = (Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Number(date.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/**
 * The renewal period suggested for a term that ran `start` → `end`: it begins
 * the day after the old one and runs for as long again.
 *
 * "As long again" is measured in whole months, because that is how leases are
 * written — a term of about a year renews to the same dates a year on, which
 * keeps a contract's anniversary where the paper says it is. Nothing here is
 * binding: the dates land in editable fields and the button states them before
 * it is pressed, so a term that was cut short (the first one, which started when
 * the books did) is the user's to correct.
 */
function nextTerm(start: string, end: string): { nextStart: string; nextEnd: string } {
  const nextStart = addDays(end, 1);
  const months = Math.max(1, Math.round(daysBetween(start, end) / DAYS_PER_MONTH));
  const nextEnd = months >= 11 && months <= 13 ? addYears(end, 1) : addDays(addMonths(nextStart, months), -1);
  return { nextStart, nextEnd };
}

/**
 * The last contract on each property of a country, keyed by asset id.
 *
 * "Last" is the one that ends latest — the term in force, or the one that just
 * ran out — not merely the most recently keyed. Vacant lines are skipped: they
 * are the record of an empty period, and there is nothing in them to renew.
 */
export async function loadLastContracts(
  companyId: string,
  country: "AE" | "PK",
): Promise<Record<string, LastContract>> {
  const supabase = await createClient();

  const [{ data: uaeLeases }, { data: pkLeases }, { data: tenants }] = await Promise.all([
    country === "AE"
      ? supabase
          .schema("rental")
          .from("uae_leases")
          .select(
            "id, asset_id, tenant_id, lease_start, lease_end, rental_amount, rent_cycle, security_deposit, currency_id, payment_terms, document_no",
          )
          .eq("company_id", companyId)
          .eq("lease_type", "standard")
          .eq("is_vacant", false)
          .is("deleted_at", null)
      : Promise.resolve({ data: null }),
    country === "PK"
      ? supabase
          .schema("rental")
          .from("pk_leases")
          .select(
            "id, asset_id, tenant_id, lease_start, lease_end, monthly_rent, official_rent, rent_cycle, security_deposit, currency_id",
          )
          .eq("company_id", companyId)
          .is("deleted_at", null)
      : Promise.resolve({ data: null }),
    supabase.schema("rental").from("tenants").select("id, name, account_id").eq("company_id", companyId),
  ]);

  const tenantById = new Map(
    (tenants ?? []).map((t) => [
      t.id as string,
      { accountId: (t.account_id as string | null) ?? null, name: (t.name as string | null) ?? null },
    ]),
  );

  const best = new Map<string, LastContract & { leaseId: string }>();
  const consider = (assetId: string | null, contract: LastContract & { leaseId: string }) => {
    if (!assetId) return;
    const kept = best.get(assetId);
    if (!kept || contract.end > kept.end) best.set(assetId, contract);
  };

  for (const l of uaeLeases ?? []) {
    const start = l.lease_start as string;
    const end = l.lease_end as string;
    if (!start || !end) continue;
    const tenant = tenantById.get(l.tenant_id as string);
    consider(l.asset_id as string | null, {
      leaseId: l.id as string,
      documentNo: (l.document_no as string | null) ?? null,
      tenantAccountId: tenant?.accountId ?? null,
      tenantName: tenant?.name ?? null,
      start,
      end,
      rentalAmount: Number(l.rental_amount) || 0,
      officialRent: null,
      securityDeposit: Number(l.security_deposit) || 0,
      rentCycle: ((l.rent_cycle as string) === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly",
      paymentTerms: ((l.payment_terms as string) ?? "monthly") as LastContract["paymentTerms"],
      currencyId: (l.currency_id as string | null) ?? null,
      expenses: [],
      ...nextTerm(start, end),
    });
  }

  for (const l of pkLeases ?? []) {
    const start = l.lease_start as string;
    const end = l.lease_end as string;
    if (!start || !end) continue;
    const tenant = tenantById.get(l.tenant_id as string);
    consider(l.asset_id as string | null, {
      leaseId: l.id as string,
      documentNo: null,
      tenantAccountId: tenant?.accountId ?? null,
      tenantName: tenant?.name ?? null,
      start,
      end,
      rentalAmount: Number(l.monthly_rent) || 0,
      officialRent: l.official_rent === null ? null : Number(l.official_rent),
      securityDeposit: Number(l.security_deposit) || 0,
      rentCycle: ((l.rent_cycle as string) === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly",
      paymentTerms: "monthly",
      currencyId: (l.currency_id as string | null) ?? null,
      expenses: [],
      ...nextTerm(start, end),
    });
  }

  // The named monthly expenses that go with each kept UAE contract, so a renewal
  // carries the same charges rather than losing them.
  const uaeLeaseIds = [...best.values()].map((c) => c.leaseId);
  if (country === "AE" && uaeLeaseIds.length) {
    const { data: expenses } = await supabase
      .schema("rental")
      .from("lease_expenses")
      .select("lease_id, account_id, amount")
      .in("lease_id", uaeLeaseIds);
    const byLease = new Map<string, { accountId: string; amount: number }[]>();
    for (const e of expenses ?? []) {
      const list = byLease.get(e.lease_id as string) ?? [];
      if (e.account_id) list.push({ accountId: e.account_id as string, amount: Number(e.amount) });
      byLease.set(e.lease_id as string, list);
    }
    for (const contract of best.values()) contract.expenses = byLease.get(contract.leaseId) ?? [];
  }

  const out: Record<string, LastContract> = {};
  for (const [assetId, contract] of best) {
    const { leaseId: _leaseId, ...rest } = contract;
    void _leaseId;
    out[assetId] = rest;
  }
  return out;
}
