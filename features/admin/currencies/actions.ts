"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { addCurrencySchema, type AddCurrencyInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function addCurrency(input: AddCurrencyInput) {
  const parsed = addCurrencySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("currencies", "create");

  const supabase = await createClient();
  const { error } = await supabase.schema("core").from("currencies").insert({
    code: parsed.data.code,
    name: parsed.data.name,
    symbol: parsed.data.symbol,
    decimal_places: parsed.data.decimalPlaces,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/currencies");
  return { success: true };
}

export async function setCompanyCurrencyActive(currencyId: string, isActive: boolean) {
  await requirePermission("currencies", "edit");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("company_currencies")
    .upsert(
      { company_id: companyId, currency_id: currencyId, is_active: isActive },
      { onConflict: "company_id,currency_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/admin/currencies");
  return { success: true };
}

export async function setBaseCurrency(currencyId: string) {
  await requirePermission("currencies", "edit");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .rpc("fn_set_base_currency", { p_company_id: companyId, p_currency_id: currencyId });

  if (error) return { error: error.message };

  revalidatePath("/admin/currencies");
  return { success: true };
}
