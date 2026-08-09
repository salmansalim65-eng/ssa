"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { PermissionAction } from "@/types/database.types";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data as string;
}

/**
 * Replace a user's per-user permission matrix for the active company. Only the
 * checked (allowed) cells are stored; the resolver treats a user with any rows
 * as fully configured (unchecked = denied). Passing an empty grant list clears
 * the custom matrix, so the user falls back to their role's permissions.
 */
export async function setUserPermissions(
  userId: string,
  grants: { moduleKey: string; action: PermissionAction }[],
) {
  await requirePermission("users", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error: delErr } = await supabase
    .schema("core")
    .from("user_permissions")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (delErr) return { error: delErr.message };

  if (grants.length > 0) {
    const rows = grants.map((g) => ({
      user_id: userId,
      company_id: companyId,
      module_key: g.moduleKey,
      action: g.action,
      allowed: true,
      created_by: user.user!.id,
    }));
    const { error: insErr } = await supabase.schema("core").from("user_permissions").insert(rows);
    if (insErr) return { error: insErr.message };
  }

  revalidatePath(`/admin/users/${userId}/permissions`);
  return { success: true };
}
