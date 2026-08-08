import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { RolesManager } from "./roles-manager";

export default async function RolesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: roles }, { data: permissions }, canCreate, canEdit, canDelete] =
    await Promise.all([
      supabase
        .schema("core")
        .from("roles")
        .select("id, name, description, is_system_role")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("created_at"),
      supabase.schema("core").from("permissions").select("id, module_key, action").order("module_key"),
      hasPermission("roles", "create"),
      hasPermission("roles", "edit"),
      hasPermission("roles", "delete"),
    ]);

  const roleIds = (roles ?? []).map((r) => r.id);
  const { data: rolePermissions } = roleIds.length
    ? await supabase
        .schema("core")
        .from("role_permissions")
        .select("role_id, permission_id, allowed")
        .in("role_id", roleIds)
    : { data: [] };

  const grantsByRole: Record<string, Record<string, boolean>> = {};
  for (const rp of rolePermissions ?? []) {
    grantsByRole[rp.role_id] ??= {};
    grantsByRole[rp.role_id][rp.permission_id] = rp.allowed;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Roles & Permissions"
        description="Configure what each role can view, create, edit, delete, print, export, approve, reject, and post across every module."
      />
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <RolesManager
          roles={roles ?? []}
          permissions={permissions ?? []}
          grantsByRole={grantsByRole}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </div>
    </div>
  );
}
