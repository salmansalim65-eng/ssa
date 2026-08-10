import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface TenantAccountOption {
  /** The chart-of-accounts account id (what the lease form submits). */
  id: string;
  name: string;
}

/**
 * Tenants for a lease come from the Chart of Accounts: leaf accounts under a
 * group flagged `is_tenant_group`, filtered by the account's country so a UAE
 * lease only offers UAE tenants (and Pakistan only Pakistan). Returns the
 * account id + name for the lease tenant dropdown.
 */
export async function loadTenantAccounts(companyId: string, countryCode: string): Promise<TenantAccountOption[]> {
  const supabase = await createClient();

  const { data: groups } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_tenant_group", true)
    .is("deleted_at", null);
  const groupIds = (groups ?? []).map((g) => g.id);
  if (groupIds.length === 0) return [];

  const { data } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_name")
    .eq("company_id", companyId)
    .eq("is_group", false)
    .eq("is_active", true)
    .is("deleted_at", null)
    .eq("country", countryCode)
    .in("parent_id", groupIds)
    .order("account_name");
  return (data ?? []).map((a) => ({ id: a.id, name: a.account_name }));
}

/**
 * Resolves whatever the lease form submitted for the tenant into a
 * rental.tenants id. The form now submits a chart-of-accounts account id, so we
 * find (or create) the mirror tenant row for that account. Idempotent: a value
 * that is already a rental.tenants id passes straight through (keeps lease copy
 * working, which forwards an existing tenant id).
 */
export async function resolveTenantId(companyId: string, submittedId: string, createdBy: string): Promise<string> {
  const supabase = await createClient();

  // Already a tenant id?
  const { data: byId } = await supabase
    .schema("rental")
    .from("tenants")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", submittedId)
    .is("deleted_at", null)
    .maybeSingle();
  if (byId) return byId.id;

  // A tenant already mirrors this account?
  const { data: byAccount } = await supabase
    .schema("rental")
    .from("tenants")
    .select("id")
    .eq("company_id", companyId)
    .eq("account_id", submittedId)
    .is("deleted_at", null)
    .maybeSingle();
  if (byAccount) return byAccount.id;

  // Create the mirror tenant from the account's details.
  const { data: account } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("account_name, id_number, phone, email")
    .eq("company_id", companyId)
    .eq("id", submittedId)
    .maybeSingle();
  if (!account) throw new Error("Selected tenant account not found");

  const { data: created, error } = await supabase
    .schema("rental")
    .from("tenants")
    .insert({
      company_id: companyId,
      name: account.account_name,
      id_number: account.id_number ?? null,
      phone: account.phone ?? null,
      email: account.email ?? null,
      account_id: submittedId,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Failed to link tenant account");
  return created.id;
}

/** For lease edit: maps a stored tenant id back to its account id so the tenant
 * dropdown (which lists account ids) preselects the right option. */
export async function accountIdForTenant(companyId: string, tenantId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("rental")
    .from("tenants")
    .select("account_id")
    .eq("company_id", companyId)
    .eq("id", tenantId)
    .maybeSingle();
  return data?.account_id ?? tenantId;
}
