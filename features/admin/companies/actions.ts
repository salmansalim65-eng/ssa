"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { updateCompanySchema, type UpdateCompanyInput } from "./schemas";

export async function updateCompany(companyId: string, input: UpdateCompanyInput) {
  const parsed = updateCompanySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("companies", "edit");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("companies")
    .update({
      name: parsed.data.name,
      country: parsed.data.country,
      address: parsed.data.address || null,
    })
    .eq("id", companyId);

  if (error) return { error: error.message };

  revalidatePath("/admin/companies");
  return { success: true };
}
