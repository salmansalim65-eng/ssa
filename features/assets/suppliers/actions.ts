"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { supplierSchema, type SupplierInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

function toRow(input: SupplierInput) {
  return {
    name: input.name,
    contact_person: input.contactPerson || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
  };
}

export async function createSupplier(input: SupplierInput) {
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("purchase_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: supplier, error } = await supabase
    .schema("assets")
    .from("suppliers")
    .insert({ ...toRow(parsed.data), company_id: companyId, created_by: user.user!.id })
    .select("id, name")
    .single();

  if (error || !supplier) return { error: error?.message ?? "Failed to create supplier" };

  revalidatePath("/assets/suppliers");
  return { success: true, supplier };
}

export async function updateSupplier(supplierId: string, input: SupplierInput) {
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("purchase_voucher", "edit");
  const supabase = await createClient();
  const { error } = await supabase.schema("assets").from("suppliers").update(toRow(parsed.data)).eq("id", supplierId);
  if (error) return { error: error.message };

  revalidatePath("/assets/suppliers");
  return { success: true };
}

export async function setSupplierActive(supplierId: string, isActive: boolean) {
  await requirePermission("purchase_voucher", "edit");
  const supabase = await createClient();
  const { error } = await supabase
    .schema("assets")
    .from("suppliers")
    .update({ is_active: isActive })
    .eq("id", supplierId);
  if (error) return { error: error.message };

  revalidatePath("/assets/suppliers");
  return { success: true };
}
