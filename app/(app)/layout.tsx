import { redirect } from "next/navigation";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .schema("core")
    .from("user_profiles")
    .select("full_name, default_company_id")
    .eq("id", user.id)
    .single();

  // A user added by an admin gets a company membership but their profile's
  // default_company_id may be unset (older accounts). Since core.current_company_id()
  // reads default_company_id, an unset one would leave them stranded on the
  // "Set up your company" onboarding. Adopt their existing membership instead and
  // persist it (self-update policy allows), so the whole app scopes correctly.
  let companyId = profile?.default_company_id as string | null | undefined;
  if (!companyId) {
    const { data: membership } = await supabase
      .schema("core")
      .from("user_companies")
      .select("company_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    companyId = (membership?.company_id as string | undefined) ?? null;
    if (companyId) {
      await supabase.schema("core").from("user_profiles").update({ default_company_id: companyId }).eq("id", user.id);
    }
  }

  if (!companyId) {
    redirect("/onboarding");
  }

  const { data: company } = await supabase
    .schema("core")
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .single();

  return (
    <AppShell
      sidebar={<Sidebar />}
      header={
        <Header
          fullName={profile?.full_name ?? ""}
          email={user.email ?? ""}
          companyName={company?.name ?? ""}
        />
      }
    >
      {children}
    </AppShell>
  );
}
