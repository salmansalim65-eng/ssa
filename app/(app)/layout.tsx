import { redirect } from "next/navigation";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AppShell } from "@/components/layout/app-shell";
import { hasPermission } from "@/lib/auth/permissions";
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

  // Modules this user may view — the sidebar shows only those sections. Admins
  // get every module (null = no restriction).
  const [{ data: company }, { data: isAdmin }, { data: permittedModules }, canSeeApprovals, { count: pendingCount }] =
    await Promise.all([
      supabase.schema("core").from("companies").select("name").eq("id", companyId).single(),
      supabase.schema("core").rpc("is_admin"),
      supabase.schema("core").rpc("user_permitted_view_modules"),
      hasPermission("approval_workflows", "view"),
      // Counted for everyone and shown only to those allowed the approvals
      // module — the same gate the dashboard's Pending approvals card uses.
      supabase
        .schema("accounting")
        .from("voucher_approvals")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "pending"),
    ]);
  // null = no restriction (admin, or the RPC isn't available yet — before its
  // migration runs — so we don't lock a non-admin out with an empty menu). Only
  // a real array from the function restricts the nav.
  const allowedModules = isAdmin || !Array.isArray(permittedModules) ? null : (permittedModules as string[]);

  return (
    <AppShell
      sidebar={<Sidebar allowedModules={allowedModules} />}
      header={
        <Header
          fullName={profile?.full_name ?? ""}
          email={user.email ?? ""}
          companyName={company?.name ?? ""}
          allowedModules={allowedModules}
          isAdmin={isAdmin === true}
          pendingApprovals={canSeeApprovals ? pendingCount ?? 0 : null}
        />
      }
    >
      {children}
    </AppShell>
  );
}
