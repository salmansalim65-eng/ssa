import { redirect } from "next/navigation";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
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
    <div className="flex min-h-screen flex-1">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          fullName={profile.full_name}
          email={user.email ?? ""}
          companyName={company?.name ?? ""}
        />
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
