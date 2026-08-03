"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
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

  const { data: lease, error } = await supabase
    .schema("rental")
    .from("uae_leases")
    .insert({
      company_id: companyId,
      asset_id: parsed.data.assetId,
      tenant_id: parsed.data.tenantId,
      lease_start: parsed.data.leaseStart,
      lease_end: parsed.data.leaseEnd,
      rental_amount: parsed.data.rentalAmount,
      rent_cycle: parsed.data.rentCycle,
      security_deposit: parsed.data.securityDeposit,
      currency_id: parsed.data.currencyId,
      created_by: user.user!.id,
    })
    .select("id")
    .single();

  if (error || !lease) return { error: error?.message ?? "Failed to create lease" };

  revalidatePath("/rental/uae/leases");
  return { success: true, id: lease.id };
}

export async function setUaeLeaseStatus(leaseId: string, status: "active" | "expired" | "terminated") {
  await requirePermission("uae_rent_invoice", "edit");
  const supabase = await createClient();
  const { error } = await supabase.schema("rental").from("uae_leases").update({ status }).eq("id", leaseId);
  if (error) return { error: error.message };

  revalidatePath(`/rental/uae/leases/${leaseId}`);
  return { success: true };
}
