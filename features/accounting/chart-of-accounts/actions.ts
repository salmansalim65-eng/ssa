"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { accountSchema, type AccountInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

async function resolveOpeningBalanceCurrencyId(companyId: string, currencyId: string | null) {
  if (currencyId) return currencyId;

  const supabase = await createClient();
  const { data } = await supabase
    .schema("core")
    .from("company_currencies")
    .select("currency_id")
    .eq("company_id", companyId)
    .eq("is_base_currency", true)
    .single();

  return data?.currency_id ?? null;
}

export async function createAccount(input: AccountInput) {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("chart_of_accounts", "create");
  const companyId = await getCurrentCompanyId();
  const currencyId = parsed.data.currencyId || null;

  if (await isDuplicateAccountName(companyId, parsed.data.accountName)) {
    return { error: "An account with this name already exists." };
  }

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: accountCode, error: codeError } = await supabase.schema("core").rpc("fn_next_master_code", {
    p_company_id: companyId,
    p_module_key: "chart_of_accounts",
    p_default_prefix: "AC",
    p_default_padding: 6,
  });
  if (codeError || !accountCode) return { error: codeError?.message ?? "Failed to generate account code" };

  const { error } = await supabase.schema("accounting").from("chart_of_accounts").insert({
    company_id: companyId,
    account_code: accountCode,
    account_name: parsed.data.accountName,
    parent_id: parsed.data.parentId || null,
    account_type: parsed.data.accountType,
    currency_id: currencyId,
    opening_balance_currency_id: await resolveOpeningBalanceCurrencyId(companyId, currencyId),
    opening_balance: parsed.data.openingBalance,
    is_group: parsed.data.isGroup,
    is_cash: parsed.data.isCash,
    is_bank: parsed.data.isBank,
    is_tenant_group: parsed.data.isGroup ? parsed.data.isTenantGroup : false,
    id_number: parsed.data.idNumber || null,
    contact_person: parsed.data.contactPerson || null,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    country: parsed.data.country || null,
    created_by: user.user!.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/accounting/chart-of-accounts");
  return { success: true };
}

export async function updateAccount(accountId: string, input: AccountInput) {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("chart_of_accounts", "edit");
  const companyId = await getCurrentCompanyId();
  const currencyId = parsed.data.currencyId || null;

  if (await isDuplicateAccountName(companyId, parsed.data.accountName, accountId)) {
    return { error: "An account with this name already exists." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .update({
      // account_code is immutable once generated; not updated here.
      account_name: parsed.data.accountName,
      parent_id: parsed.data.parentId || null,
      account_type: parsed.data.accountType,
      currency_id: currencyId,
      opening_balance_currency_id: await resolveOpeningBalanceCurrencyId(companyId, currencyId),
      opening_balance: parsed.data.openingBalance,
      is_group: parsed.data.isGroup,
      is_cash: parsed.data.isCash,
      is_bank: parsed.data.isBank,
      is_tenant_group: parsed.data.isGroup ? parsed.data.isTenantGroup : false,
      id_number: parsed.data.idNumber || null,
      contact_person: parsed.data.contactPerson || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      country: parsed.data.country || null,
    })
    .eq("id", accountId);

  if (error) return { error: error.message };

  revalidatePath("/accounting/chart-of-accounts");
  return { success: true };
}

// The three document slots on an account, mapped to their attachment-id columns.
const ATTACHMENT_COLUMNS = {
  id: "id_attachment_id",
  police: "police_verification_attachment_id",
  agreement: "rent_agreement_attachment_id",
} as const;
export type AccountAttachmentSlot = keyof typeof ATTACHMENT_COLUMNS;

/** Points a document slot at an uploaded attachment, or clears it when null. */
export async function setAccountAttachment(
  accountId: string,
  slot: AccountAttachmentSlot,
  attachmentId: string | null,
) {
  await requirePermission("chart_of_accounts", "edit");
  const column = ATTACHMENT_COLUMNS[slot];
  if (!column) return { error: "Invalid attachment slot" };

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .update({ [column]: attachmentId })
    .eq("id", accountId);
  if (error) return { error: error.message };

  revalidatePath("/accounting/chart-of-accounts");
  return { success: true };
}

/** Loads a slot's current file (name + short-lived signed URL), or null. */
export async function getAccountAttachment(accountId: string, slot: AccountAttachmentSlot) {
  const column = ATTACHMENT_COLUMNS[slot];
  if (!column) return null;

  const supabase = await createClient();
  const { data: acct } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select(column)
    .eq("id", accountId)
    .maybeSingle();
  const attachmentId = (acct as Record<string, string | null> | null)?.[column] ?? null;
  if (!attachmentId) return null;

  const { data: att } = await supabase
    .schema("core")
    .from("attachments")
    .select("id, file_name, bucket, path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!att) return null;

  const { data: signed } = await supabase.storage.from(att.bucket).createSignedUrl(att.path, 60 * 60);
  return { id: att.id, fileName: att.file_name, url: signed?.signedUrl ?? null };
}

export async function setAccountActive(accountId: string, isActive: boolean) {
  await requirePermission("chart_of_accounts", "edit");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .update({ is_active: isActive })
    .eq("id", accountId);

  if (error) return { error: error.message };

  revalidatePath("/accounting/chart-of-accounts");
  return { success: true };
}

// Reorders an account among its siblings (accounts with the same parent). Only
// the sort_order of the affected siblings changes — never the parent,
// account_code or accounting history — so the move is inherently
// hierarchy-safe. `direction` slides the account within its sibling list.
export async function moveAccount(accountId: string, direction: "up" | "down" | "top" | "bottom") {
  await requirePermission("chart_of_accounts", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: account } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, parent_id")
    .eq("company_id", companyId)
    .eq("id", accountId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!account) return { error: "Account not found" };

  let siblingQuery = supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, sort_order, account_code")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  siblingQuery = account.parent_id
    ? siblingQuery.eq("parent_id", account.parent_id)
    : siblingQuery.is("parent_id", null);
  const { data: siblings } = await siblingQuery;

  const ordered = (siblings ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.account_code.localeCompare(b.account_code));
  const from = ordered.findIndex((s) => s.id === accountId);
  if (from === -1) return { error: "Account not found" };

  let to = from;
  if (direction === "up") to = Math.max(0, from - 1);
  else if (direction === "down") to = Math.min(ordered.length - 1, from + 1);
  else if (direction === "top") to = 0;
  else if (direction === "bottom") to = ordered.length - 1;
  if (to === from) return { success: true };

  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);

  // Renumber to a contiguous 0..n sequence, persisting only the rows that moved.
  const byId = new Map((siblings ?? []).map((s) => [s.id, s.sort_order]));
  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index];
    if (byId.get(row.id) === index) continue;
    const { error } = await supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .update({ sort_order: index })
      .eq("id", row.id);
    if (error) return { error: error.message };
  }

  revalidatePath("/accounting/chart-of-accounts");
  return { success: true };
}

export async function deleteAccount(accountId: string) {
  await requirePermission("chart_of_accounts", "delete");

  const supabase = await createClient();
  // Definer guard: blocks accounts with active children or transaction history,
  // otherwise soft-deletes. Surfaces a clear message on refusal.
  const { error } = await supabase.schema("accounting").rpc("fn_soft_delete_account", { p_id: accountId });
  if (error) return { error: error.message };

  revalidatePath("/accounting/chart-of-accounts");
  return { success: true };
}

// Rejects a name that already belongs to another non-deleted account in the
// same company (case-insensitive). excludeId skips the account being edited.
async function isDuplicateAccountName(companyId: string, name: string, excludeId?: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_name")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  const target = name.trim().toLowerCase();
  return (data ?? []).some((a) => a.id !== excludeId && a.account_name.trim().toLowerCase() === target);
}
