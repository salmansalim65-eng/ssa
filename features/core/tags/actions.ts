"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { tagSchema, type TagInput } from "./schemas";

const LIST_PATH = "/accounting/tags";

/** Both screens a tag reaches: its own list, and the expense voucher form. */
function revalidateTagPages() {
  revalidatePath(LIST_PATH);
  revalidatePath("/accounting/vouchers/expense_voucher");
  revalidatePath("/dashboard");
}

function rowFrom(input: TagInput) {
  return {
    name: input.name,
    description: input.description || null,
    is_active: input.isActive,
  };
}

/** The unique index is on the name, so a duplicate comes back as a clear message. */
function friendlyError(message: string) {
  return /duplicate key|idx_tags_company_name/i.test(message) ? "A tag with that name already exists." : message;
}

export async function createTag(input: TagInput) {
  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("tags", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("core")
    .from("tags")
    .insert({ ...rowFrom(parsed.data), company_id: companyId, created_by: user.user!.id });
  if (error) return { error: friendlyError(error.message) };

  revalidateTagPages();
  return { success: true };
}

export async function updateTag(id: string, input: TagInput) {
  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("tags", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("core")
    .from("tags")
    .update({ ...rowFrom(parsed.data), updated_by: user.user!.id, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) return { error: friendlyError(error.message) };

  revalidateTagPages();
  return { success: true };
}

/**
 * Soft delete — the row stays so vouchers already filed under the tag keep
 * reading it, but it leaves every picker and list.
 */
export async function deleteTag(id: string) {
  await requirePermission("tags", "delete");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("core")
    .from("tags")
    .update({ deleted_by: user.user!.id, deleted_at: new Date().toISOString(), is_active: false })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateTagPages();
  return { success: true };
}
