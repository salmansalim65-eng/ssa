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

  if (!profile?.default_company_id) {
    redirect("/onboarding");
  }

  const { data: company } = await supabase
    .schema("core")
    .from("companies")
    .select("name")
    .eq("id", profile.default_company_id)
    .single();

  return (
    <AppShell
      sidebar={<Sidebar />}
      header={
        <Header
          fullName={profile.full_name}
          email={user.email ?? ""}
          companyName={company?.name ?? ""}
        />
      }
    >
      {children}
    </AppShell>
  );
}
