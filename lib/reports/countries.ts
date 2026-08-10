import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface ReportCountryOption {
  code: string;
  name: string;
}

/** Active countries for the company, used to populate report country filters. */
export async function loadReportCountries(companyId: string): Promise<ReportCountryOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("core")
    .from("countries")
    .select("code, name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  return data ?? [];
}
