"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { generateAllUaeRentInvoices, postAllUaeRentInvoices } from "@/features/rental/uae-rent-invoices/actions";
import { hhLeaseSchema, type HhLeaseInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

/**
 * HH Lease voucher: one tenant + one document header, many asset lines. Each
 * line becomes its own rental.uae_leases row (and therefore gets its own
 * auto-generated payment schedule), all stamped with the shared document
 * number so the voucher can be recognised later.
 */
export async function createHhLease(input: HhLeaseInput) {
  const parsed = hhLeaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("uae_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const { data: documentNo, error: numberError } = await supabase
    .schema("rental")
    .rpc("fn_next_hh_lease_no", { p_company_id: companyId });
  if (numberError || !documentNo) {
    return { error: numberError?.message ?? "Failed to generate document number" };
  }

  const rows = parsed.data.lines.map((line) => ({
    company_id: companyId,
    asset_id: line.assetId,
    tenant_id: parsed.data.tenantId,
    lease_start: line.leaseStart,
    lease_end: line.leaseEnd,
    rental_amount: line.rentalAmount,
    rent_cycle: parsed.data.rentCycle,
    security_deposit: 0,
    currency_id: parsed.data.currencyId,
    rent_month: null,
    remarks: line.remarks || null,
    document_no: documentNo as string,
    document_date: parsed.data.documentDate,
    created_by: createdBy,
  }));

  const { data: createdLeases, error } = await supabase
    .schema("rental")
    .from("uae_leases")
    .insert(rows)
    .select("id");
  if (error) return { error: error.message };

  // HH leases are uae_leases — admins get every created line's invoices
  // generated + posted automatically; best-effort so drafts remain on failure.
  if (await isCurrentUserAdmin()) {
    for (const created of createdLeases ?? []) {
      try {
        await generateAllUaeRentInvoices(created.id);
        await postAllUaeRentInvoices(created.id);
      } catch {
        /* best-effort; drafts remain for manual posting */
      }
    }
  }

  revalidatePath("/rental/uae/leases");
  return { success: true, documentNo: documentNo as string, count: rows.length };
}
