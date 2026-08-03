"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { documentSequenceSchema, type DocumentSequenceInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function upsertDocumentSequence(input: DocumentSequenceInput) {
  const parsed = documentSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("document_sequences", "edit");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();

  const { data: existing } = await supabase
    .schema("core")
    .from("document_sequences")
    .select("id")
    .eq("company_id", companyId)
    .eq("voucher_type", parsed.data.voucherType)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .schema("core")
        .from("document_sequences")
        .update({
          prefix: parsed.data.prefix,
          padding: parsed.data.padding,
          reset_policy: parsed.data.resetPolicy,
        })
        .eq("id", existing.id)
    : await supabase.schema("core").from("document_sequences").insert({
        company_id: companyId,
        voucher_type: parsed.data.voucherType,
        prefix: parsed.data.prefix,
        padding: parsed.data.padding,
        reset_policy: parsed.data.resetPolicy,
      });

  if (error) return { error: error.message };

  revalidatePath("/admin/document-sequences");
  return { success: true };
}
