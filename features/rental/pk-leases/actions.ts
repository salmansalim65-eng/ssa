"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/rental/tenant-accounts";
import { generateAllPkRentInvoices, postAllPkRentInvoices } from "@/features/rental/pk-rent-invoices/actions";
import { pkLeaseSchema, type PkLeaseInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function createPkLease(input: PkLeaseInput) {
  const parsed = pkLeaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pk_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const tenantId = await resolveTenantId(companyId, parsed.data.tenantId, user.user!.id);

  const { data: lease, error } = await supabase
    .schema("rental")
    .from("pk_leases")
    .insert({
      company_id: companyId,
      asset_id: parsed.data.assetId,
      tenant_id: tenantId,
      lease_start: parsed.data.leaseStart,
      lease_end: parsed.data.leaseEnd,
      monthly_rent: parsed.data.monthlyRent,
      official_rent: typeof parsed.data.officialRent === "number" ? parsed.data.officialRent : null,
      rent_cycle: parsed.data.rentCycle,
      advance_rent: parsed.data.advanceRent,
      security_deposit: parsed.data.securityDeposit,
      currency_id: parsed.data.currencyId,
      due_date: parsed.data.dueDate || null,
      voucher_date: parsed.data.voucherDate || null,
      created_by: user.user!.id,
    })
    .select("id")
    .single();

  if (error || !lease) return { error: error?.message ?? "Failed to create lease" };

  // Remarks written in a separate, tolerant update so a lease still saves if the
  // remarks-column migration hasn't been applied yet.
  if (parsed.data.remarks) {
    await supabase.schema("rental").from("pk_leases").update({ remarks: parsed.data.remarks }).eq("id", lease.id);
  }

  // Every lease auto-generates and posts its invoices on creation. The lease is
  // created regardless, but a real failure (e.g. missing posting template) is
  // surfaced as a warning instead of being silently swallowed.
  let invoiceWarning: string | undefined;
  try {
    const gen = await generateAllPkRentInvoices(lease.id);
    if (gen.error && gen.error !== "No pending periods left to invoice.") invoiceWarning = gen.error;
    const post = await postAllPkRentInvoices(lease.id);
    if (post.failed.length > 0) {
      invoiceWarning = `Some invoices could not be posted: ${post.failed.map((f) => f.reason).join("; ")}`;
    }
  } catch (e) {
    invoiceWarning = e instanceof Error ? e.message : "Invoice generation failed";
  }

  revalidatePath("/rental/pk/leases");
  return { success: true, id: lease.id, invoiceWarning };
}

export async function updatePkLease(id: string, input: PkLeaseInput) {
  const parsed = pkLeaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pk_rent_invoice", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const tenantId = await resolveTenantId(companyId, parsed.data.tenantId, user.user!.id);

  // Definer applies the new terms, wipes + regenerates the payment schedule, and
  // removes any unposted invoices; it refuses the edit if any invoice is posted.
  const { error } = await supabase.schema("rental").rpc("fn_update_pk_lease", {
    p_lease_id: id,
    p_asset_id: parsed.data.assetId,
    p_tenant_id: tenantId,
    p_lease_start: parsed.data.leaseStart,
    p_lease_end: parsed.data.leaseEnd,
    p_monthly_rent: parsed.data.monthlyRent,
    p_advance_rent: parsed.data.advanceRent,
    p_security_deposit: parsed.data.securityDeposit,
    p_currency_id: parsed.data.currencyId,
    p_due_date: parsed.data.dueDate || null,
    p_rent_month: null,
    p_official_rent: typeof parsed.data.officialRent === "number" ? parsed.data.officialRent : null,
    p_rent_cycle: parsed.data.rentCycle,
  });
  if (error) return { error: error.message };

  // voucher_date is display-only and not part of the update RPC — persist it
  // directly (the same table allows the direct status update used elsewhere).
  await supabase
    .schema("rental")
    .from("pk_leases")
    .update({ voucher_date: parsed.data.voucherDate || null })
    .eq("id", id);

  // Remarks persisted separately (tolerant of the column not existing yet).
  if (parsed.data.remarks !== undefined) {
    await supabase
      .schema("rental")
      .from("pk_leases")
      .update({ remarks: parsed.data.remarks || null })
      .eq("id", id);
  }

  revalidatePath("/rental/pk/leases");
  revalidatePath(`/rental/pk/leases/${id}`);
  return { success: true, id };
}

export async function copyPkLease(id: string) {
  await requirePermission("pk_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: src } = await supabase
    .schema("rental")
    .from("pk_leases")
    .select(
      "asset_id, tenant_id, lease_start, lease_end, monthly_rent, official_rent, rent_cycle, advance_rent, security_deposit, currency_id, due_date, voucher_date",
    )
    .eq("company_id", companyId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!src) return { error: "Lease not found" };

  // A fresh lease with the same terms; its own schedule is generated on insert.
  return createPkLease({
    assetId: src.asset_id,
    tenantId: src.tenant_id,
    leaseStart: src.lease_start,
    leaseEnd: src.lease_end,
    monthlyRent: src.monthly_rent,
    officialRent: src.official_rent ?? "",
    rentCycle: (src.rent_cycle ?? "monthly") as "monthly" | "quarterly" | "yearly",
    advanceRent: src.advance_rent,
    securityDeposit: src.security_deposit,
    currencyId: src.currency_id,
    dueDate: src.due_date ?? "",
    voucherDate: src.voucher_date ?? new Date().toISOString().slice(0, 10),
  });
}

export async function setPkLeaseStatus(leaseId: string, status: "active" | "expired" | "terminated") {
  await requirePermission("pk_rent_invoice", "edit");
  const supabase = await createClient();
  const { error } = await supabase.schema("rental").from("pk_leases").update({ status }).eq("id", leaseId);
  if (error) return { error: error.message };

  revalidatePath(`/rental/pk/leases/${leaseId}`);
  return { success: true };
}

export async function deletePkLease(leaseId: string) {
  await requirePermission("pk_rent_invoice", "delete");
  const supabase = await createClient();

  // Soft delete runs through a SECURITY DEFINER function: a direct UPDATE that
  // sets deleted_at is rejected by the `deleted_at IS NULL` SELECT policy,
  // which Postgres also enforces against the new row version. Business data is
  // never hard-deleted (see docs/01-architecture).
  const { error } = await supabase.schema("rental").rpc("fn_delete_pk_lease", { p_lease_id: leaseId });
  if (error) return { error: error.message };

  revalidatePath("/rental/pk/leases");
  return { success: true };
}
