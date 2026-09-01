"use server";

import { revalidatePath } from "next/cache";

import { hasPermission, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createJournalEntry, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { accountSchema, type AccountInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const DEBIT_NORMAL_TYPES = new Set(["asset", "expense"]);

// Finds (or creates) the "Opening Balance Equity" contra account used to balance
// auto-posted opening-balance entries.
async function resolveOpeningBalanceEquityId(companyId: string, userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("account_type", "equity")
    .is("deleted_at", null)
    .ilike("account_name", "Opening Balance Equity")
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: code } = await supabase.schema("core").rpc("fn_next_master_code", {
    p_company_id: companyId,
    p_module_key: "chart_of_accounts",
    p_default_prefix: "AC",
    p_default_padding: 6,
  });
  if (!code) return null;
  const { data: created } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .insert({
      company_id: companyId,
      account_code: code,
      account_name: "Opening Balance Equity",
      account_type: "equity",
      is_group: false,
      created_by: userId,
    })
    .select("id")
    .single();
  return (created?.id as string | undefined) ?? null;
}

// Brings an account's posted opening balance to the target by posting only the
// DELTA needed (account vs Opening Balance Equity contra). Posted journal
// entries are immutable, so we never edit prior entries — create sets it, an
// edit posts the difference, and clearing it posts a reversing difference. A
// zero delta is a no-op, so this is safe to call on every save.
async function syncAccountOpeningBalance(params: {
  accountId: string;
  companyId: string;
  userId: string;
  accountType: AccountInput["accountType"];
  openingBalance: number;
  currencyId: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const isDebitNormal = DEBIT_NORMAL_TYPES.has(params.accountType);
  // Desired net (debit − credit, document amounts) from opening-balance entries.
  const target = round2(
    isDebitNormal ? Number(params.openingBalance) || 0 : -(Number(params.openingBalance) || 0),
  );

  // Current posted opening-balance net for this account.
  const { data: obJes } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("voucher_type", "opening_balance_voucher")
    .eq("status", "posted");
  const obJeIds = (obJes ?? []).map((j) => j.id as string);
  let currentNet = 0;
  // Rate the account's existing opening balance was booked at. An adjustment or
  // reversal reuses it, so clearing/changing an opening balance never depends on
  // a *current* exchange rate being configured (which for e.g. a PKR property
  // may not exist as of 1 Jan).
  let existingRate: number | null = null;
  if (obJeIds.length) {
    const { data: lines } = await supabase
      .schema("accounting")
      .from("journal_entry_lines")
      .select("debit_amount, credit_amount, exchange_rate")
      .eq("account_id", params.accountId)
      .in("journal_entry_id", obJeIds);
    currentNet = round2(
      (lines ?? []).reduce((s, l) => s + Number(l.debit_amount) - Number(l.credit_amount), 0),
    );
    const rated = (lines ?? []).find((l) => Number(l.exchange_rate) > 0);
    if (rated) existingRate = Number(rated.exchange_rate);
  }

  const delta = round2(target - currentNet);
  if (delta === 0) return {};

  const contraId = await resolveOpeningBalanceEquityId(params.companyId, params.userId);
  if (!contraId) return { error: "Could not resolve the Opening Balance Equity account" };
  const currencyId = await resolveOpeningBalanceCurrencyId(params.companyId, params.currencyId);
  if (!currencyId) return { error: "No currency configured for the opening balance" };

  const amt = Math.abs(delta);
  const accountDebit = delta > 0 ? amt : 0;
  const accountCredit = delta > 0 ? 0 : amt;
  const lines: EntryLineInput[] = [
    { accountId: params.accountId, debit: accountDebit, credit: accountCredit, description: "Opening balance" },
    { accountId: contraId, debit: accountCredit, credit: accountDebit, description: "Opening balance" },
  ];
  const asOfDate = `${new Date().getFullYear()}-01-01`;
  const voucherId = crypto.randomUUID();

  // createJournalEntry resolves the currency's exchange rate, which throws when
  // no rate is configured for this currency as of the opening-balance date (e.g.
  // a PKR property with no PKR rate on 1 Jan). Catch it so the account save
  // surfaces a clear message instead of crashing the whole page.
  let je: Awaited<ReturnType<typeof createJournalEntry>>;
  try {
    je = await createJournalEntry({
      companyId: params.companyId,
      voucherType: "opening_balance_voucher",
      voucherId,
      entryDate: asOfDate,
      currencyId,
      // Reuse the original booking rate when adjusting/reversing an existing
      // opening balance; only a brand-new opening balance resolves a fresh rate.
      exchangeRate: existingRate ?? undefined,
      narration: "Opening balance",
      createdBy: params.userId,
      lines,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to post the opening balance" };
  }
  if ("error" in je) return { error: je.error };

  await supabase.schema("accounting").from("opening_balance_vouchers").insert({
    id: voucherId,
    company_id: params.companyId,
    journal_entry_id: je.journalEntryId,
    as_of_date: asOfDate,
    contra_account_id: contraId,
    cost_center_id: null,
    currency_id: currencyId,
    exchange_rate: je.exchangeRate,
    narration: "Opening balance",
    total_amount: amt,
    created_by: params.userId,
  });
  await supabase.schema("accounting").from("opening_balance_voucher_lines").insert({
    voucher_id: voucherId,
    line_no: 1,
    account_id: params.accountId,
    debit: accountDebit,
    credit: accountCredit,
  });

  const posted = await postVoucher({
    companyId: params.companyId,
    voucherType: "opening_balance_voucher",
    journalEntryId: je.journalEntryId,
  });
  if ("error" in posted) return { error: posted.error };
  await supabase
    .schema("accounting")
    .from("opening_balance_vouchers")
    .update({ voucher_no: posted.voucherNo })
    .eq("id", voucherId);
  return {};
}

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
  propertyTax?: number;
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
    property_tax: p?.propertyTax ?? 0,
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
  isRental: boolean;
}): Promise<{ assetId?: string; error?: string }> {
  // Service-role client: properties are managed from Chart of Accounts, so this
  // internal asset sync must not be blocked by the Assets-module RLS. The caller
  // is already gated by requirePermission("chart_of_accounts", …); every write
  // stays scoped to params.companyId.
  const supabase = createAdminClient();
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
        is_rental: params.isRental,
        ...(params.property ? assetColumnsFromProperty(params.property, value) : {}),
      })
      .eq("id", params.existingAssetId)
      .eq("company_id", params.companyId);
    if (error) return { error: error.message };
    return { assetId: params.existingAssetId };
  }

  // Generate the next asset code directly against the sequence. The auth-checked
  // fn_next_master_code RPC rejects the service-role client (no current_company_id),
  // which is why creating a property from CoA previously failed with
  // "Not authorized for company". Manual, low-frequency creation, and the
  // asset_code unique constraint guards the rare concurrent-code race.
  await supabase
    .schema("core")
    .from("document_sequences")
    .upsert(
      { company_id: params.companyId, voucher_type: "assets", prefix: "AST", padding: 6 },
      { onConflict: "company_id,voucher_type", ignoreDuplicates: true },
    );
  const { data: seq, error: codeError } = await supabase
    .schema("core")
    .from("document_sequences")
    .select("id, prefix, padding, next_number")
    .eq("company_id", params.companyId)
    .eq("voucher_type", "assets")
    .single();
  if (codeError || !seq) return { error: codeError?.message ?? "Failed to generate asset code" };
  const nextNumber = Number(seq.next_number);
  const assetCode = `${seq.prefix}-${String(nextNumber).padStart(Number(seq.padding), "0")}`;
  await supabase
    .schema("core")
    .from("document_sequences")
    .update({ next_number: nextNumber + 1 })
    .eq("id", seq.id);

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
      is_rental: params.isRental,
      created_by: params.userId,
      // Point the asset at THIS Chart-of-Accounts account so the
      // trg_link_asset_account trigger doesn't auto-create a second, duplicate
      // GL account under "ASSETS" (the property account already is its account).
      account_id: params.accountId,
      ...assetColumns,
    })
    .select("id")
    .single();
  if (error || !asset) return { error: error?.message ?? "Failed to create the linked property" };

  // Seed the opening value into the asset's value history (previous = null).
  // Direct insert rather than fn_log_value_change, which also rejects the
  // service-role client.
  const seededValue = assetColumns.current_value;
  if (seededValue > 0) {
    await supabase.schema("assets").from("asset_value_history").insert({
      company_id: params.companyId,
      asset_id: asset.id,
      effective_date: new Date().toISOString().slice(0, 10),
      previous_value: null,
      new_value: seededValue,
      changed_by: params.userId,
      remarks: "Created from Chart of Accounts",
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

/**
 * Which permission module governs an account. A GROUP account shapes the chart
 * itself, so it is governed by `account_groups`; a posting account, which is
 * day-to-day data entry, by `chart_of_accounts`. That lets an administrator let
 * someone add accounts without letting them restructure the chart.
 */
function accountModule(isGroup: boolean) {
  return isGroup ? "account_groups" : "chart_of_accounts";
}

/** The stored group flag of an account, so a write can be checked against it. */
async function isGroupAccount(accountId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("is_group")
    .eq("id", accountId)
    .maybeSingle();
  return Boolean(data?.is_group);
}

export async function createAccount(input: AccountInput) {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission(accountModule(parsed.data.isGroup), "create");
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

  // Register the property in Assets when the account sits under PROPERTIES (or,
  // for backward compatibility, when the rental flag is ticked on any asset
  // account). The rental flag itself only controls lease visibility.
  const isProperty = !parsed.data.isGroup && (await isPropertiesParent(parsed.data.parentId));
  if (isProperty || parsed.data.isRentalProperty) {
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
      isRental: parsed.data.isRentalProperty,
    });
    if (link.error) {
      revalidatePath("/accounting/chart-of-accounts");
      return { error: `Account saved, but registering it as a property failed: ${link.error}` };
    }
    revalidatePath("/assets");
  }

  // Post the opening balance to the ledger (account vs Opening Balance Equity).
  if (!parsed.data.isGroup) {
    const ob = await syncAccountOpeningBalance({
      accountId: account.id,
      companyId,
      userId: user.user!.id,
      accountType: parsed.data.accountType,
      openingBalance: parsed.data.openingBalance,
      currencyId,
    });
    if (ob.error) {
      revalidatePath("/accounting/chart-of-accounts");
      return { error: `Account saved, but posting its opening balance failed: ${ob.error}` };
    }
  }

  revalidatePath("/accounting/chart-of-accounts");
  return { success: true };
}

// True when the given parent account sits under the "PROPERTIES" group — the
// group itself OR any group nested beneath it (e.g. "DUBAI PROPERTIES",
// "PK PROPERTIES"). Accounts created under it are registered as properties in
// the Assets module. Walks the ancestor chain so nested property groups count.
async function isPropertiesParent(parentId: string | null | undefined): Promise<boolean> {
  if (!parentId) return false;
  const supabase = await createClient();
  let currentId: string | null = parentId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const result = await supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("account_name, parent_id")
      .eq("id", currentId)
      .maybeSingle();
    const row = result.data as { account_name: string | null; parent_id: string | null } | null;
    if (!row) return false;
    if ((row.account_name ?? "").trim().toUpperCase() === "PROPERTIES") return true;
    currentId = row.parent_id ?? null;
  }
  return false;
}

// Delegates to ensureLinkedAsset. Properties are managed from Chart of Accounts,
// so the caller's chart_of_accounts create/edit permission (already checked in
// createAccount/updateAccount) is the authority here — the linked asset is an
// internal detail and is synced with the service-role client, without demanding
// a separate Assets-module permission.
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
  isRental: boolean;
}): Promise<{ assetId?: string; error?: string }> {
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
    propertyTax: d.propertyTax,
    otherCharges: d.otherCharges,
    estimatedRent: d.estimatedRent,
    notes: d.propertyNotes,
  };
}

// Heals the duplicate-GL-account problem (see migration 0089): when a property
// is saved, remove any stray same-named account auto-created under the "ASSETS"
// group by trg_link_asset_account. Only true strays are touched — a non-group
// account directly under ASSETS, not deleted, with no linked_asset_id and no
// ledger lines. Any asset still pointing at the stray is repointed to the kept
// (property) account first. Uses the service-role client (runtime, RLS-free).
async function purgeStrayAssetAccounts(companyId: string, accountName: string, keepAccountId: string) {
  const admin = createAdminClient();
  const { data: group } = await admin
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_group", true)
    .is("deleted_at", null)
    .ilike("account_name", "ASSETS")
    .maybeSingle();
  if (!group) return;

  const target = accountName.trim().toLowerCase();
  const { data: candidates } = await admin
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_name, linked_asset_id")
    .eq("company_id", companyId)
    .eq("parent_id", group.id)
    .eq("is_group", false)
    .is("deleted_at", null);

  for (const c of candidates ?? []) {
    const id = c.id as string;
    if (id === keepAccountId) continue;
    if (c.linked_asset_id) continue;
    if ((c.account_name as string).trim().toLowerCase() !== target) continue;
    const { count } = await admin
      .schema("accounting")
      .from("journal_entry_lines")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id);
    if ((count ?? 0) > 0) continue;
    await admin.schema("assets").from("assets").update({ account_id: keepAccountId }).eq("account_id", id);
    await admin
      .schema("accounting")
      .from("chart_of_accounts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
  }
}

// One-shot healer for existing data: removes every stray duplicate asset GL
// account for a company (the ASSETS-group twin of a linked property account,
// with no ledger lines). Idempotent — a no-op once the data is clean — so it is
// safe to call on the Chart of Accounts page load. Uses the service-role client.
// Exported as a server action, so it derives the company from the session and
// no-ops for non-editors (never trusts a client-supplied company).
export async function healStrayAssetAccounts() {
  if (!(await hasPermission("chart_of_accounts", "edit"))) return;
  const companyId = await getCurrentCompanyId();
  const admin = createAdminClient();
  const { data: group } = await admin
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_group", true)
    .is("deleted_at", null)
    .ilike("account_name", "ASSETS")
    .maybeSingle();
  if (!group) return;

  const { data: all } = await admin
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_name, parent_id, linked_asset_id, is_group")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  const rows = all ?? [];
  const norm = (n: unknown) => String(n ?? "").trim().toLowerCase();
  // name -> a real account (has linked_asset_id) with that name.
  const linkedByName = new Map<string, string>();
  for (const r of rows) if (r.linked_asset_id) linkedByName.set(norm(r.account_name), r.id as string);

  const strays = rows.filter(
    (r) => !r.is_group && !r.linked_asset_id && r.parent_id === (group.id as string) && linkedByName.has(norm(r.account_name)),
  );
  for (const s of strays) {
    const keep = linkedByName.get(norm(s.account_name))!;
    const { count } = await admin
      .schema("accounting")
      .from("journal_entry_lines")
      .select("id", { count: "exact", head: true })
      .eq("account_id", s.id);
    if ((count ?? 0) > 0) continue;
    await admin.schema("assets").from("assets").update({ account_id: keep }).eq("account_id", s.id);
    await admin
      .schema("accounting")
      .from("chart_of_accounts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", s.id as string);
  }
}

export async function updateAccount(accountId: string, input: AccountInput) {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Checked against what the account IS — and, when it is being converted
  // between a group and a posting account, against what it is becoming too.
  const wasGroup = await isGroupAccount(accountId);
  await requirePermission(accountModule(wasGroup), "edit");
  if (parsed.data.isGroup !== wasGroup) {
    await requirePermission(accountModule(parsed.data.isGroup), "edit");
  }
  const companyId = await getCurrentCompanyId();
  const currencyId = parsed.data.currencyId || null;

  const isProperty = !parsed.data.isGroup && (await isPropertiesParent(parsed.data.parentId));

  // For a property, first clear any stray duplicate GL account auto-created
  // under ASSETS for it, so the duplicate-name guard below doesn't block the save.
  if (isProperty || parsed.data.isRentalProperty) {
    await purgeStrayAssetAccounts(companyId, parsed.data.accountName, accountId);
  }

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
  let existingAssetId = (current?.linked_asset_id as string | null) ?? null;
  // Fallback: some properties link only the other way round (assets.account_id
  // → this account) with chart_of_accounts.linked_asset_id never populated. Find
  // that asset too, so toggling the Rental flag (which maps to assets.is_rental,
  // the Rental Property Report's filter) always reaches the property — otherwise
  // un-ticking Rental silently fails and the property keeps showing in the report.
  if (!existingAssetId) {
    const { data: linkedAsset } = await createAdminClient()
      .schema("assets")
      .from("assets")
      .select("id")
      .eq("company_id", companyId)
      .eq("account_id", accountId)
      .is("deleted_at", null)
      .maybeSingle();
    existingAssetId = (linkedAsset?.id as string | null) ?? null;
  }

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

  // Register/sync the linked property when the account is under PROPERTIES, is
  // already linked, or (legacy) has the rental flag ticked. The rental flag maps
  // to the asset's is_rental (lease visibility) — unticking never deletes the
  // property, only stops it appearing in new leases.
  if (isProperty || existingAssetId || parsed.data.isRentalProperty) {
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
      isRental: parsed.data.isRentalProperty,
    });
    if (link.error) {
      revalidatePath("/accounting/chart-of-accounts");
      return { error: `Account saved, but updating its property failed: ${link.error}` };
    }
    revalidatePath("/assets");
    revalidatePath(`/assets/${link.assetId}`);
  }

  // Keep the account's opening-balance ledger entry in step (create / update /
  // remove). Groups can't post, so any stray entry is removed.
  const ob = await syncAccountOpeningBalance({
    accountId,
    companyId,
    userId: user.user!.id,
    accountType: parsed.data.accountType,
    openingBalance: parsed.data.isGroup ? 0 : parsed.data.openingBalance,
    currencyId,
  });
  if (ob.error) {
    revalidatePath("/accounting/chart-of-accounts");
    return { error: `Account saved, but updating its opening balance failed: ${ob.error}` };
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
  await requirePermission(accountModule(await isGroupAccount(accountId)), "edit");

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
  await requirePermission(accountModule(await isGroupAccount(accountId)), "edit");
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
  await requirePermission(accountModule(await isGroupAccount(accountId)), "delete");

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
