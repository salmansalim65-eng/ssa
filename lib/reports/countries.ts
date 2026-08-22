import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface ReportCountryOption {
  code: string;
  name: string;
}

/**
 * All country-code spellings equivalent to `code`, so a report country filter
 * matches data stored under either code. The app mixes ISO-2 ("AE"/"PK") from
 * cost centres with "UAE"/"PK" from assets & rental, and a party account's own
 * country can be either — fold them together here.
 */
export function equivalentCountryCodes(code: string): string[] {
  const u = code.trim().toUpperCase();
  if (u === "AE" || u === "UAE") return ["AE", "UAE"];
  if (u === "PK" || u === "PAK" || u === "PAKISTAN") return ["PK", "PAK", "PAKISTAN"];
  return [code];
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
