"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/rental/tenant-accounts";
import { generateAllUaeRentInvoices, postAllUaeRentInvoices } from "@/features/rental/uae-rent-invoices/actions";
import { uaeLeaseSchema, type UaeLeaseInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function createUaeLease(input: UaeLeaseInput) {
  const parsed = uaeLeaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("uae_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const tenantId = await resolveTenantId(companyId, parsed.data.tenantId, user.user!.id);

  const { data: lease, error } = await supabase
    .schema("rental")
    .from("uae_leases")
    .insert({
      company_id: companyId,
      asset_id: parsed.data.assetId,
      tenant_id: tenantId,
      lease_start: parsed.data.leaseStart,
      lease_end: parsed.data.leaseEnd,
      rental_amount: parsed.data.rentalAmount,
      rent_cycle: parsed.data.rentCycle,
      security_deposit: parsed.data.securityDeposit,
      currency_id: parsed.data.currencyId,
      due_date: parsed.data.dueDate || null,
      voucher_date: parsed.data.voucherDate || null,
      created_by: user.user!.id,
    })
    .select("id")
    .single();

  if (error || !lease) return { error: error?.message ?? "Failed to create lease" };

  // Admins get invoices generated + posted automatically. The lease is created
  // regardless, but a real failure (e.g. missing posting template) is surfaced
  // as a warning instead of being silently swallowed.
  let invoiceWarning: string | undefined;
  if (await isCurrentUserAdmin()) {
    try {
      const gen = await generateAllUaeRentInvoices(lease.id);
      if (gen.error && gen.error !== "No pending periods left to invoice.") invoiceWarning = gen.error;
      const post = await postAllUaeRentInvoices(lease.id);
      if (post.failed.length > 0) {
        invoiceWarning = `Some invoices could not be posted: ${post.failed.map((f) => f.reason).join("; ")}`;
      }
    } catch (e) {
      invoiceWarning = e instanceof Error ? e.message : "Invoice generation failed";
    }
  }

  revalidatePath("/rental/uae/leases");
  return { success: true, id: lease.id, invoiceWarning };
}

export async function updateUaeLease(id: string, input: UaeLeaseInput) {
  const parsed = uaeLeaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("uae_rent_invoice", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const tenantId = await resolveTenantId(companyId, parsed.data.tenantId, user.user!.id);

  // Definer applies the new terms, wipes + regenerates the payment schedule, and
  // removes any unposted invoices; it refuses the edit if any invoice is posted.
  const { error } = await supabase.schema("rental").rpc("fn_update_uae_lease", {
    p_lease_id: id,
    p_asset_id: parsed.data.assetId,
    p_tenant_id: tenantId,
    p_lease_start: parsed.data.leaseStart,
    p_lease_end: parsed.data.leaseEnd,
    p_rental_amount: parsed.data.rentalAmount,
    p_rent_cycle: parsed.data.rentCycle,
    p_security_deposit: parsed.data.securityDeposit,
    p_currency_id: parsed.data.currencyId,
    p_due_date: parsed.data.dueDate || null,
    p_rent_month: null,
  });
  if (error) return { error: error.message };

  // voucher_date is display-only and not part of the update RPC — persist it
  // directly (the same table allows the direct status update used elsewhere).
  await supabase
    .schema("rental")
    .from("uae_leases")
    .update({ voucher_date: parsed.data.voucherDate || null })
    .eq("id", id);

  revalidatePath("/rental/uae/leases");
  revalidatePath(`/rental/uae/leases/${id}`);
  return { success: true, id };
}

export async function copyUaeLease(id: string) {
  await requirePermission("uae_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: src } = await supabase
    .schema("rental")
    .from("uae_leases")
    .select(
      "asset_id, tenant_id, lease_start, lease_end, rental_amount, rent_cycle, security_deposit, currency_id, due_date, voucher_date",
    )
    .eq("company_id", companyId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!src) return { error: "Lease not found" };

  // A fresh lease with the same terms; its own schedule is generated on insert.
  return createUaeLease({
    assetId: src.asset_id,
    tenantId: src.tenant_id,
    leaseStart: src.lease_start,
    leaseEnd: src.lease_end,
    rentalAmount: src.rental_amount,
    rentCycle: src.rent_cycle as "monthly" | "yearly",
    securityDeposit: src.security_deposit,
    currencyId: src.currency_id,
    dueDate: src.due_date ?? "",
    voucherDate: src.voucher_date ?? "",
  });
}

export async function setUaeLeaseStatus(leaseId: string, status: "active" | "expired" | "terminated") {
  await requirePermission("uae_rent_invoice", "edit");
  const supabase = await createClient();
  const { error } = await supabase.schema("rental").from("uae_leases").update({ status }).eq("id", leaseId);
  if (error) return { error: error.message };

  revalidatePath(`/rental/uae/leases/${leaseId}`);
  return { success: true };
}

export async function deleteUaeLease(leaseId: string) {
  await requirePermission("uae_rent_invoice", "delete");
  const supabase = await createClient();

  // Soft delete runs through a SECURITY DEFINER function: a direct UPDATE that
  // sets deleted_at is rejected by the `deleted_at IS NULL` SELECT policy,
  // which Postgres also enforces against the new row version. Business data is
  // never hard-deleted (see docs/01-architecture).
  const { error } = await supabase.schema("rental").rpc("fn_delete_uae_lease", { p_lease_id: leaseId });
  if (error) return { error: error.message };

  revalidatePath("/rental/uae/leases");
  return { success: true };
}
