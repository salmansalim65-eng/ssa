"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

/** Derive a short code from a country name when the user doesn't supply one. */
function deriveCode(name: string): string {
  const cleaned = name.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map((w) => w[0]).join("").slice(0, 3);
}

export interface CreateCountryInput {
  name: string;
  code?: string;
}

/**
 * Adds a country to the per-company country master used by the asset form.
 * Codes/names are unique per company (case-insensitive on name) so "UAE" and
 * "United Arab Emirates" can coexist deliberately but exact duplicates cannot.
 */
export async function createCountry(input: CreateCountryInput) {
  const name = input.name?.trim();
  if (!name || name.length < 2) return { error: "Country name is required" };

  const code = (input.code?.trim() || deriveCode(name)).toUpperCase();
  if (!code) return { error: "Could not determine a country code" };

  await requirePermission("countries", "create");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: country, error } = await supabase
    .schema("core")
    .from("countries")
    .insert({ company_id: companyId, code, name, created_by: user.user!.id })
    .select("code, name")
    .single();

  if (error || !country) {
    if (error?.code === "23505") {
      return { error: "A country with this code or name already exists." };
    }
    return { error: error?.message ?? "Failed to add country" };
  }

  revalidatePath("/assets");
  return { success: true, code: country.code, name: country.name };
}
