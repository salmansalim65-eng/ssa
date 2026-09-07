import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatAccountCode } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { RecurringExpenseManager, type RecurringExpenseRow } from "./recurring-expense-manager";

export default async function RecurringExpensesPage() {
  const [canView, canCreate, canEdit, canDelete] = await Promise.all([
    hasPermission("recurring_expenses", "view"),
    hasPermission("recurring_expenses", "create"),
    hasPermission("recurring_expenses", "edit"),
    hasPermission("recurring_expenses", "delete"),
  ]);
  if (!canView) redirect("/dashboard");

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const [{ data: rows }, { data: accounts }, { data: costCentres }, { data: companyCurrencies }] =
    await Promise.all([
      supabase
        .schema("accounting")
        .from("recurring_expenses")
        .select(
          "id, name, account_id, cost_center_id, currency_id, amount, frequency, day_of_month, start_date, end_date, notes, is_active",
        )
        .eq("company_id", companyId)
        .order("name"),
      supabase
        .schema("accounting")
        .from("chart_of_accounts")
        .select("id, account_code, account_name")
        .eq("company_id", companyId)
        .eq("account_type", "expense")
        .eq("is_group", false)
        .is("deleted_at", null)
        .order("account_code"),
      supabase
        .schema("accounting")
        .from("cost_centers")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("is_group", false)
        .is("deleted_at", null)
        .order("name"),
      supabase
        .schema("core")
        .from("company_currencies")
        .select("currencies:currency_id(id, code)")
        .eq("company_id", companyId)
        .eq("is_active", true),
    ]);

  type RawCurrency = { currencies: { id: string; code: string } | null };
  const currencies = ((companyCurrencies as unknown as RawCurrency[]) ?? [])
    .filter((c) => c.currencies)
    .map((c) => ({ id: c.currencies!.id, label: c.currencies!.code }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Recurring Expenses"
        description="Costs that fall due on a schedule — salaries, utilities, service charges, a tax instalment. They are a planning schedule, not vouchers: the Cash Flow Forecast deducts them, the ledger is untouched until you post the payment."
        backHref="/reports/cash-flow"
        backLabel="Cash Flow Forecast"
      />

      <RecurringExpenseManager
        rows={(rows ?? []) as unknown as RecurringExpenseRow[]}
        accounts={(accounts ?? []).map((a) => ({
          id: a.id as string,
          label: `${formatAccountCode(a.account_code as string)} — ${a.account_name as string}`,
        }))}
        costCentres={(costCentres ?? []).map((c) => ({ id: c.id as string, label: c.name as string }))}
        currencies={currencies}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
