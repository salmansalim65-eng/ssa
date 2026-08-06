"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { exchangeRateSchema, type ExchangeRateInput } from "./schemas";

export async function upsertExchangeRate(input: ExchangeRateInput) {
  const parsed = exchangeRateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("exchange_rates", "edit");

  const supabase = await createClient();
  const { data: companyId, error: companyError } = await supabase
    .schema("core")
    .rpc("current_company_id");
  if (companyError || !companyId) return { error: "No active company" };

  const { error } = await supabase.schema("core").rpc("fn_upsert_exchange_rate", {
    p_company_id: companyId,
    p_currency_id: parsed.data.currencyId,
    p_rate_date: parsed.data.rateDate,
    p_rate_to_base: parsed.data.rateToBase,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/exchange-rates");
  return { success: true };
}

export async function deleteExchangeRate(id: string) {
  await requirePermission("exchange_rates", "edit");

  const supabase = await createClient();
  // The exchange_rates write policy (ALL) already scopes deletes to the current
  // company + the 'exchange_rates' edit permission, so a direct delete is safe.
  const { error } = await supabase.schema("core").from("exchange_rates").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/exchange-rates");
  return { success: true };
}
