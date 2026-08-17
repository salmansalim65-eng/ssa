import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  // Verify the JWT locally (cached keys) rather than a network round-trip to the
  // Auth server — the middleware has already gate-kept the session.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) redirect("/login");
  return { id: claims.sub as string, email: (claims.email as string | undefined) ?? null };
}

export async function getActiveCompany() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .schema("core")
    .from("user_profiles")
    .select("default_company_id")
    .eq("id", user.id)
    .single();

  if (!profile?.default_company_id) return null;

  const { data: company } = await supabase
    .schema("core")
    .from("companies")
    .select("id, code, name, country")
    .eq("id", profile.default_company_id)
    .single();

  return company ?? null;
}
