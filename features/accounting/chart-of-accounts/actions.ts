"use server";

import { revalidatePath } from "next/cache";

import { hasPermission, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { accountSchema, type AccountInput } from "./schemas";

// Descriptive property fields captured on the CoA form (when the account sits
// under PROPERTIES) and written through to the linked asset. Empty/zero values
// simply carry through — on create they seed the asset, on re-sync they align it
// (the form prefills these from the asset, so an overwrite is not destructive).
interface PropertyFields {
  propertyType?: string;
  status: "active" | "inactive" | "sold";
  city?: string;
  address?: string;
  owner?: string;
  officialOwner?: string;
  purchaseDate?: string;
  areaSqft?: number;
  areaUnit?: string;
  purchaseValue?: number;
  currentValue?: number;
  titleDeedValue?: number;
  serviceChargesRate?: number;
  otherCharges?: number;
  estimatedRent?: number;
  notes?: string;
}

// Maps the CoA property fields onto assets.assets columns. `fallbackValue` (the
// account opening balance) seeds the asset value when no purchase value is set.
function assetColumnsFromProperty(p: PropertyFields | undefined, fallbackValue: number) {
  const purchase = p?.purchaseValue && p.purchaseValue > 0 ? p.purchaseValue : fallbackValue;
  const current = p?.currentValue && p.currentValue > 0 ? p.currentValue : purchase;
  return {
    property_type: p?.propertyType || "Property",
    city: p?.city || null,
    address: p?.address || null,
    owner: p?.owner || null,
    official_owner: p?.officialOwner || null,
    purchase_date: p?.purchaseDate || null,
    area_sqft: p?.areaSqft ?? 0,
    area_unit: p?.areaUnit || null,
    purchase_value: purchase,
    current_value: current,
    title_deed_value: p?.titleDeedValue ?? 0,
    service_charges_rate: p?.serviceChargesRate ?? 0,
    other_charges: p?.otherCharges ?? 0,
    estimated_rent: p?.estimatedRent ?? 0,
    status: p?.status ?? "active",
    notes: p?.notes || null,
  };
}

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

// Creates — or, if already linked, re-syncs — the Assets-module property behind
// a rental-property account, returning the linked asset id. Idempotent: an
// account that already points at an asset has that asset kept in step (name +
// country) rather than a second one created. The asset insert trigger in turn
// auto-creates the matching cost centre, so the property is fully wired for
// leases and accounting.
async function ensureLinkedAsset(params: {
  accountId: string;
  companyId: string;
  userId: string;
  accountName: string;
  country: string;
  currencyId: string | null;
  openingBalance: number;
  existingAssetId: string | null;
  property?: PropertyFields;
}): Promise<{ assetId?: string; error?: string }> {
  const supabase = await createClient();
  const value = Number.isFinite(params.openingBalance) ? Math.max(0, params.openingBalance) : 0;

  // Already linked → keep the property aligned with the account: identifying
  // fields plus any descriptive property details edited on the CoA form. The
  // asset→cost-centre trigger propagates name/country onward.
  if (params.existingAssetId) {
    const { error } = await supabase
      .schema("assets")
      .from("assets")
      .update({
        asset_name: params.accountName,
        country: params.country,
        ...(params.property ? assetColumnsFromProperty(params.property, value) : {}),
      })
      .eq("id", params.existingAssetId);
    if (error) return { error: error.message };
    return { assetId: params.existingAssetId };
  }

  const { data: assetCode, error: codeError } = await supabase.schema("core").rpc("fn_next_master_code", {
    p_company_id: params.companyId,
    p_module_key: "assets",
    p_default_prefix: "AST",
    p_default_padding: 6,
  });
  if (codeError || !assetCode) return { error: codeError?.message ?? "Failed to generate asset code" };

  // Seed the property from what the account knows: descriptive fields from the
  // CoA form when supplied, else its opening balance as the starting value; its
  // currency (or the base currency) as the asset currency.
  const currencyId = await resolveOpeningBalanceCurrencyId(params.companyId, params.currencyId);
  const assetColumns = assetColumnsFromProperty(params.property, value);

  const { data: asset, error } = await supabase
    .schema("assets")
    .from("assets")
    .insert({
      company_id: params.companyId,
      asset_code: assetCode,
      asset_name: params.accountName,
      country: params.country,
      currency_id: currencyId,
      cost_center_mode: "new",
      created_by: params.userId,
      ...assetColumns,
    })
    .select("id")
    .single();
  if (error || !asset) return { error: error?.message ?? "Failed to create the linked property" };

  // Seed the opening value into the asset's value history (previous = null).
  const seededValue = assetColumns.current_value;
  if (seededValue > 0) {
    await supabase.schema("assets").rpc("fn_log_value_change", {
      p_asset_id: asset.id,
      p_previous: null,
      p_new: seededValue,
      p_effective_date: null,
      p_remarks: "Created from Chart of Accounts",
    });
  }

  // Point the account at its new property.
  const { error: linkError } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .update({ linked_asset_id: asset.id })
    .eq("id", params.accountId);
  if (linkError) return { error: linkError.message };

  return { assetId: asset.id };
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

  const { data: account, error } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .insert({
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
    })
    .select("id")
    .single();

  if (error || !account) return { error: error?.message ?? "Failed to create account" };

  if (parsed.data.isRentalProperty) {
    const link = await linkRentalProperty({
      accountId: account.id,
      companyId,
      userId: user.user!.id,
      accountName: parsed.data.accountName,
      country: parsed.data.country || "",
      currencyId,
      openingBalance: parsed.data.openingBalance,
      existingAssetId: null,
      property: propertyFieldsFrom(parsed.data),
    });
    if (link.error) {
      revalidatePath("/accounting/chart-of-accounts");
      return { error: `Account saved, but registering it as a rental property failed: ${link.error}` };
    }
    revalidatePath("/assets");
  }

  revalidatePath("/accounting/chart-of-accounts");
  return { success: true };
}

// Permission-guards then delegates to ensureLinkedAsset. Creating the property
// needs Assets "create"; re-syncing an already-linked one needs Assets "edit".
async function linkRentalProperty(params: {
  accountId: string;
  companyId: string;
  userId: string;
  accountName: string;
  country: string;
  currencyId: string | null;
  openingBalance: number;
  existingAssetId: string | null;
  property?: PropertyFields;
}): Promise<{ assetId?: string; error?: string }> {
  const action = params.existingAssetId ? "edit" : "create";
  if (!(await hasPermission("assets", action))) {
    return { error: `you need the Assets "${action}" permission.` };
  }
  return ensureLinkedAsset(params);
}

// Pulls the descriptive property fields out of a validated account form.
function propertyFieldsFrom(d: AccountInput): PropertyFields {
  return {
    propertyType: d.propertyType,
    status: d.propertyStatus,
    city: d.city,
    address: d.address,
    owner: d.owner,
    officialOwner: d.officialOwner,
    purchaseDate: d.purchaseDate,
    areaSqft: d.areaSqft,
    areaUnit: d.areaUnit,
    purchaseValue: d.purchaseValue,
    currentValue: d.currentValue,
    titleDeedValue: d.titleDeedValue,
    serviceChargesRate: d.serviceChargesRate,
    otherCharges: d.otherCharges,
    estimatedRent: d.estimatedRent,
    notes: d.propertyNotes,
  };
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
  const { data: user } = await supabase.auth.getUser();

  // Read the current property link so we sync the existing asset instead of
  // creating a duplicate.
  const { data: current } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("linked_asset_id")
    .eq("id", accountId)
    .maybeSingle();
  const existingAssetId = (current?.linked_asset_id as string | null) ?? null;

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

  // Create the linked property on first flag, or keep an existing one in step.
  // Unchecking never destroys the property (a lease may reference it) — the link
  // is left intact, which is why the form keeps the box checked once linked.
  if (parsed.data.isRentalProperty) {
    const link = await linkRentalProperty({
      accountId,
      companyId,
      userId: user.user!.id,
      accountName: parsed.data.accountName,
      country: parsed.data.country || "",
      currencyId,
      openingBalance: parsed.data.openingBalance,
      existingAssetId,
      property: propertyFieldsFrom(parsed.data),
    });
    if (link.error) {
      revalidatePath("/accounting/chart-of-accounts");
      return { error: `Account saved, but updating its rental property failed: ${link.error}` };
    }
    revalidatePath("/assets");
    revalidatePath(`/assets/${link.assetId}`);
  }

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
