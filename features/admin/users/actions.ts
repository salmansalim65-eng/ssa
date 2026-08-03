"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  inviteUserSchema,
  updateUserSchema,
  type InviteUserInput,
  type UpdateUserInput,
} from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function inviteUser(input: InviteUserInput) {
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("users", "create");
  const companyId = await getCurrentCompanyId();

  const admin = createAdminClient();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    parsed.data.email,
    { data: { full_name: parsed.data.fullName } },
  );
  if (inviteError || !invited.user) {
    return { error: inviteError?.message ?? "Failed to invite user" };
  }

  const supabase = await createClient();

  const { error: membershipError } = await supabase
    .schema("core")
    .from("user_companies")
    .insert({ user_id: invited.user.id, company_id: companyId });
  if (membershipError) return { error: membershipError.message };

  const { error: roleError } = await supabase
    .schema("core")
    .from("user_roles")
    .insert({ user_id: invited.user.id, role_id: parsed.data.roleId, company_id: companyId });
  if (roleError) return { error: roleError.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function updateUser(userId: string, input: UpdateUserInput) {
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("users", "edit");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("user_profiles")
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone || null })
    .eq("id", userId);

  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function setUserActive(userId: string, isActive: boolean) {
  await requirePermission("users", "edit");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("user_profiles")
    .update({ is_active: isActive })
    .eq("id", userId);

  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function assignRole(userId: string, roleId: string) {
  await requirePermission("users", "edit");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();
  const { error: deleteError } = await supabase
    .schema("core")
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (deleteError) return { error: deleteError.message };

  const { error: insertError } = await supabase
    .schema("core")
    .from("user_roles")
    .insert({ user_id: userId, role_id: roleId, company_id: companyId });
  if (insertError) return { error: insertError.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function removeUserFromCompany(userId: string) {
  await requirePermission("users", "delete");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();
  await supabase.schema("core").from("user_roles").delete().eq("user_id", userId).eq("company_id", companyId);
  const { error } = await supabase
    .schema("core")
    .from("user_companies")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId);

  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function sendPasswordReset(email: string) {
  await requirePermission("users", "edit");

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) return { error: error.message };

  return { success: true };
}
