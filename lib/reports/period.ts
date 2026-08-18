import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The company's accounting period start (YYYY-MM-DD), or null when unset. Used
 * by reports to default their "From" date to when the books began. Fetched
 * tolerantly so it returns null if the column isn't present yet.
 */
export async function loadAccountingPeriodStart(companyId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("core")
    .from("companies")
    .select("accounting_period_start")
    .eq("id", companyId)
    .maybeSingle();
  return (data?.accounting_period_start as string | null) ?? null;
}
