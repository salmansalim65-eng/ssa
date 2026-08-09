"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  addUserSchema,
  updateUserSchema,
  type AddUserInput,
  type UpdateUserInput,
} from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function addUser(input: AddUserInput) {
  const parsed = addUserSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("users", "create");
  const companyId = await getCurrentCompanyId();

  // Direct creation with an admin-set password (hashed by Supabase Auth). Email
  // is optional and unused for login; when omitted we mint a placeholder from
  // the (unique) username so Auth has an address and login stays username-based.
  const email = parsed.data.email || `${parsed.data.username}@no-email.invalid`;

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  });
  if (createError || !created.user) {
    return { error: createError?.message ?? "Failed to create user" };
  }

  // The signup trigger creates the user_profiles row; set the username on it via
  // the service-role client (RLS on the admin update policy requires membership,
  // which isn't inserted yet).
  const { error: usernameError } = await admin
    .schema("core")
    .from("user_profiles")
    .update({ username: parsed.data.username })
    .eq("id", created.user.id);
  if (usernameError) return { error: `User created, but username couldn't be set: ${usernameError.message}` };

  const supabase = await createClient();

  const { error: membershipError } = await supabase
    .schema("core")
    .from("user_companies")
    .insert({ user_id: created.user.id, company_id: companyId });
  if (membershipError) return { error: membershipError.message };

  const { error: roleError } = await supabase
    .schema("core")
    .from("user_roles")
    .insert({ user_id: created.user.id, role_id: parsed.data.roleId, company_id: companyId });
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
    .update({
      full_name: parsed.data.fullName,
      username: parsed.data.username || null,
      phone: parsed.data.phone || null,
    })
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
