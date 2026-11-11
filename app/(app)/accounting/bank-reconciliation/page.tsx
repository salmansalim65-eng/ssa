import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { BankReconciliation } from "@/components/accounting/bank-reconciliation";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { mapVoucherCurrencies, type RawCompanyCurrency } from "@/lib/vouchers/currencies";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

/**
 * Holding a bank statement against the books.
 *
 * Small payments go out and nobody enters them — a utility bill, a courier, a
 * transfer somebody made from their phone. The bank has the list; SSA does
 * not, and a month later nobody can remember what they were. This reads the
 * statement back against the ledger and says which lines have no entry behind
 * them, so they can be entered from the page that found them.
 */
export default async function BankReconciliationPage() {
  if (!(await hasPermission("reports", "view"))) redirect("/dashboard");

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const [{ data: accounts }, { data: companyCurrencies }] = await Promise.all([
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name, currency_id, is_cash, is_bank")
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
  ]);

  const all = ((accounts ?? []) as {
    id: string;
    account_code: string;
    account_name: string;
    currency_id: string | null;
    is_cash: boolean;
    is_bank: boolean;
  }[]).map((a) => ({
    id: a.id,
    // The NAME, and nothing else. A code is how the database tells two
    // accounts apart; nobody reconciling a bank statement knows one by heart,
    // and it only crowds out the name they are actually looking for.
    label: a.account_name,
    currencyId: a.currency_id,
    isMoney: Boolean(a.is_cash || a.is_bank),
  }));

  const currencies = await mapVoucherCurrencies(
    companyId,
    new Date().toISOString().slice(0, 10),
    companyCurrencies as unknown as RawCompanyCurrency[],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Bank reconciliation"
        description="Paste or upload a bank statement. SSA says which lines have no entry behind them — and you enter them here."
      />
      <BankReconciliation
        bankAccounts={all.filter((a) => a.isMoney)}
        allAccounts={all}
        currencies={currencies.map((c) => ({ id: c.id, code: c.code, rate: (c as { rate?: number }).rate ?? 1 }))}
      />
    </div>
  );
}
