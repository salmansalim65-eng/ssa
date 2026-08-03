"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { tenantSchema, type TenantInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

function toRow(input: TenantInput) {
  return {
    name: input.name,
    id_number: input.idNumber || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
  };
}

export async function createTenant(input: TenantInput) {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("tenants", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: tenant, error } = await supabase
    .schema("rental")
    .from("tenants")
    .insert({ ...toRow(parsed.data), company_id: companyId, created_by: user.user!.id })
    .select("id, name")
    .single();

  if (error || !tenant) return { error: error?.message ?? "Failed to create tenant" };

  revalidatePath("/rental/tenants");
  return { success: true, tenant };
}

export async function updateTenant(tenantId: string, input: TenantInput) {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("tenants", "edit");
  const supabase = await createClient();
  const { error } = await supabase.schema("rental").from("tenants").update(toRow(parsed.data)).eq("id", tenantId);
  if (error) return { error: error.message };

  revalidatePath("/rental/tenants");
  return { success: true };
}

export async function setTenantActive(tenantId: string, isActive: boolean) {
  await requirePermission("tenants", "edit");
  const supabase = await createClient();
  const { error } = await supabase.schema("rental").from("tenants").update({ is_active: isActive }).eq("id", tenantId);
  if (error) return { error: error.message };

  revalidatePath("/rental/tenants");
  return { success: true };
}
