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

/**
 * Add a whole list of tags at once, one name per line.
 *
 * A tag list is almost always pasted out of a message or a spreadsheet, so the
 * numbering people type in front of each item ("1. Petrol", "3) Pharmacy") is
 * stripped and blank lines are dropped. Names already in use are reported as
 * skipped rather than failing the batch — re-pasting a list that has grown by
 * two entries should add exactly those two.
 */
export async function createTagsBulk(raw: string) {
  await requirePermission("tags", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: existing, error: readError } = await supabase
    .schema("core")
    .from("tags")
    .select("name")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  if (readError) return { error: readError.message };
  const taken = new Set((existing ?? []).map((t) => (t.name as string).trim().toLowerCase()));

  const names: string[] = [];
  const skipped: string[] = [];
  const invalid: string[] = [];
  for (const line of raw.split("\n")) {
    const name = line
      .replace(/^\s*\d+\s*[.)\]-]\s*/, "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name) continue;
    const parsed = tagSchema.safeParse({ name, description: "", isActive: true });
    if (!parsed.success) {
      invalid.push(name);
      continue;
    }
    const key = parsed.data.name.toLowerCase();
    if (taken.has(key)) {
      skipped.push(parsed.data.name);
      continue;
    }
    taken.add(key);
    names.push(parsed.data.name);
  }

  if (names.length === 0) return { created: 0, skipped, invalid };

  const { error } = await supabase
    .schema("core")
    .from("tags")
    .insert(
      names.map((name) => ({
        name,
        description: null,
        is_active: true,
        company_id: companyId,
        created_by: user.user!.id,
      })),
    );
  if (error) return { error: friendlyError(error.message) };

  revalidateTagPages();
  return { created: names.length, skipped, invalid };
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
