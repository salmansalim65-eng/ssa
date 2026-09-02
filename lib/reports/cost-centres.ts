import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * A cost centre and every cost centre beneath it.
 *
 * Cost centres form a tree (INVESTMENT → MBL INVESTMENT, VISTA INVESTMENT, …).
 * Postings land on the leaves, so filtering a report to a GROUP by its own id
 * alone matches nothing — which is why picking INVESTMENT came back empty while
 * picking one of its children worked. Selecting a group means the group and
 * everything under it.
 */
export async function costCentreIdsWithDescendants(
  companyId: string,
  costCentreId: string,
): Promise<string[]> {
  if (!costCentreId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .select("id, parent_id")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const childrenOf = new Map<string, string[]>();
  for (const c of data ?? []) {
    const parent = (c.parent_id as string | null) ?? "";
    if (!parent) continue;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(c.id as string);
  }

  const ids = new Set<string>([costCentreId]);
  const stack = [costCentreId];
  while (stack.length) {
    for (const child of childrenOf.get(stack.pop()!) ?? []) {
      if (ids.has(child)) continue; // a cycle would otherwise loop forever
      ids.add(child);
      stack.push(child);
    }
  }
  return [...ids];
}

/**
 * Accounts that name one of `costCentreIds` as their default cost centre.
 *
 * The cost-centre reports read the cost centre off each ledger line, which is
 * whatever the voucher carried. A line posted without one still belongs to a
 * cost centre when its ACCOUNT says so — which is how entries raised before a
 * cost centre existed, or simply raised without picking one, still reach the
 * cost-centre reports. Mirrors the way chart_of_accounts.country already stands
 * in for a missing cost centre when a balance is attributed to a country.
 */
export async function accountIdsForCostCentres(
  companyId: string,
  costCentreIds: string[],
): Promise<string[]> {
  if (costCentreIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", companyId)
    .in("default_cost_center_id", costCentreIds)
    .is("deleted_at", null);
  return (data ?? []).map((a) => a.id as string);
}

/** Both halves of the filter at once: the cost centre subtree, and the accounts defaulting into it. */
export async function resolveCostCentreScope(companyId: string, costCentreId: string) {
  const costCentreIds = await costCentreIdsWithDescendants(companyId, costCentreId);
  const accountIds = await accountIdsForCostCentres(companyId, costCentreIds);
  return { costCentreIds, accountIds };
}

/**
 * PostgREST `or` filter for "tagged to one of these cost centres, or untagged on
 * an account that defaults into them". Null when nothing needs filtering.
 */
export function costCentreOrFilter(costCentreIds: string[], accountIds: string[]): string | null {
  if (costCentreIds.length === 0) return null;
  const tagged = `cost_center_id.in.(${costCentreIds.join(",")})`;
  if (accountIds.length === 0) return tagged;
  return `${tagged},and(cost_center_id.is.null,account_id.in.(${accountIds.join(",")}))`;
}
