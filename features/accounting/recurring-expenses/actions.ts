"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { recurringExpenseSchema, type RecurringExpenseInput } from "./schemas";

const LIST_PATH = "/accounting/recurring-expenses";

function rowFrom(input: RecurringExpenseInput) {
  return {
    name: input.name,
    account_id: input.accountId || null,
    cost_center_id: input.costCenterId || null,
    currency_id: input.currencyId,
    amount: input.amount,
    frequency: input.frequency,
    day_of_month: input.dayOfMonth,
    start_date: input.startDate,
    end_date: input.endDate || null,
    notes: input.notes || null,
    is_active: input.isActive,
  };
}

export async function createRecurringExpense(input: RecurringExpenseInput) {
  const parsed = recurringExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("recurring_expenses", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("accounting")
    .from("recurring_expenses")
    .insert({ ...rowFrom(parsed.data), company_id: companyId, created_by: user.user!.id });
  if (error) return { error: error.message };

  revalidatePath(LIST_PATH);
  revalidatePath("/reports/cash-flow");
  return { success: true };
}

export async function updateRecurringExpense(id: string, input: RecurringExpenseInput) {
  const parsed = recurringExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("recurring_expenses", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("accounting")
    .from("recurring_expenses")
    .update({ ...rowFrom(parsed.data), updated_by: user.user!.id, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(LIST_PATH);
  revalidatePath("/reports/cash-flow");
  return { success: true };
}

/** Soft delete — the row stays for the audit trail but leaves every list and forecast. */
export async function deleteRecurringExpense(id: string) {
  await requirePermission("recurring_expenses", "delete");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("accounting")
    .from("recurring_expenses")
    .update({ deleted_by: user.user!.id, deleted_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(LIST_PATH);
  revalidatePath("/reports/cash-flow");
  return { success: true };
}
