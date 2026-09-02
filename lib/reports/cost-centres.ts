import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Accounts that name `costCentreId` as their default cost centre.
 *
 * The cost-centre reports read the cost centre off each ledger line, which is
 * whatever the voucher carried. A line posted without one still belongs to a
 * cost centre when its ACCOUNT says so — which is how entries raised before a
 * cost centre existed, or simply raised without picking one, still reach the
 * cost-centre reports. Mirrors the way chart_of_accounts.country already stands
 * in for a missing cost centre when a balance is attributed to a country.
 */
export async function accountIdsForCostCentre(
  companyId: string,
  costCentreId: string,
): Promise<string[]> {
  if (!costCentreId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("default_cost_center_id", costCentreId)
    .is("deleted_at", null);
  return (data ?? []).map((a) => a.id as string);
}

/**
 * PostgREST `or` filter for "tagged to this cost centre, or untagged on an
 * account that defaults to it". Null when no account defaults to it, in which
 * case the caller's plain equality filter is already right.
 */
export function costCentreOrFilter(costCentreId: string, accountIds: string[]): string | null {
  if (!costCentreId || accountIds.length === 0) return null;
  return `cost_center_id.eq.${costCentreId},and(cost_center_id.is.null,account_id.in.(${accountIds.join(",")}))`;
}
