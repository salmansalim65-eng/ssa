"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { roleSchema, type RoleInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function createRole(input: RoleInput) {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("roles", "create");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("roles")
    .insert({
      company_id: companyId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      created_by: (await supabase.auth.getUser()).data.user!.id,
    });

  if (error) return { error: error.message };

  revalidatePath("/admin/roles");
  return { success: true };
}

export async function deleteRole(roleId: string, isSystemRole: boolean) {
  await requirePermission("roles", "delete");
  if (isSystemRole) return { error: "System roles cannot be deleted" };

  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("roles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", roleId);

  if (error) return { error: error.message };

  revalidatePath("/admin/roles");
  return { success: true };
}

export async function setRolePermission(
  roleId: string,
  permissionId: string,
  allowed: boolean,
) {
  await requirePermission("roles", "edit");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("role_permissions")
    .upsert(
      { role_id: roleId, permission_id: permissionId, allowed },
      { onConflict: "role_id,permission_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/admin/roles");
  return { success: true };
}
