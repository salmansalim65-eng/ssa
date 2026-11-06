import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { RentStatementForm, type UnitOption } from "@/components/rental/rent-statement-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { toAccountOptions, type RawAccountRow } from "@/lib/vouchers/account-currency";
import { mapVoucherCurrencies, type RawCompanyCurrency } from "@/lib/vouchers/currencies";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

/**
 * Entering the agent's monthly sheet.
 *
 * The accounts offered are every account, because which one is "the agent" is
 * the company's business and changes: today it is TOP LINE DXB, and a second
 * agent would be a second account rather than a second screen.
 */
export default async function NewRentStatementPage() {
  if (!(await hasPermission("rent_statement", "create"))) redirect("/dashboard");

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const [{ data: accounts }, { data: companyCurrencies }, { data: costCenters }] = await Promise.all([
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name, currency_id, country, default_cost_center_id")
      .eq("company_id", companyId)
      .eq("is_group", false)
      .is("deleted_at", null)
      .order("account_code"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, code, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("code"),
  ]);

  const accountOptions = toAccountOptions((accounts ?? []) as RawAccountRow[]);
  // Base currency first, so the form opens on it.
  const currencyOptions = await mapVoucherCurrencies(
    companyId,
    new Date().toISOString().slice(0, 10),
    companyCurrencies as unknown as RawCompanyCurrency[],
  );
  const units: UnitOption[] = ((costCenters ?? []) as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rental"
        title="New rent statement"
        description="The letting agent's monthly sheet — short-term and long-term units together, as one document."
        backHref="/rental/rent-statements"
      />
      <RentStatementForm accounts={accountOptions} currencies={currencyOptions} units={units} />
    </div>
  );
}
