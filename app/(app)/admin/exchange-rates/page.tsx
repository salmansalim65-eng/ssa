import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { deleteExchangeRate } from "@/features/admin/exchange-rates/actions";
import { ExchangeRateForm, type RateableCurrency } from "./exchange-rate-form";
import { ExchangeRateHistory, type RateHistoryRow } from "./exchange-rate-history";

export default async function ExchangeRatesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: companyCurrencies }, canEdit] = await Promise.all([
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code, name)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    hasPermission("exchange_rates", "edit"),
  ]);

  type Row = { is_base_currency: boolean; currencies: { id: string; code: string; name: string } | null };
  const rateableCurrencies: RateableCurrency[] = ((companyCurrencies as unknown as Row[]) ?? [])
    .filter((cc) => !cc.is_base_currency && cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code, name: cc.currencies!.name }));

  const { data: rates } = await supabase
    .schema("core")
    .from("exchange_rates")
    .select("id, rate_date, rate_to_base, source, currencies:currency_id(code)")
    .eq("company_id", companyId)
    .order("rate_date", { ascending: false })
    .limit(200);

  type RateRow = {
    id: string;
    rate_date: string;
    rate_to_base: number;
    source: string;
    currencies: { code: string } | null;
  };
  const historyRows: RateHistoryRow[] = ((rates as unknown as RateRow[]) ?? []).map((r) => ({
    id: r.id,
    rateDate: r.rate_date,
    rateToBase: r.rate_to_base,
    source: r.source,
    currencyCode: r.currencies?.code ?? "—",
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Daily Exchange Rates"
        description="One rate per currency per day, relative to this company's base currency. Historical rates are never overwritten by a later date."
      />

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Record a rate</CardTitle>
          </CardHeader>
          <CardContent>
            <ExchangeRateForm currencies={rateableCurrencies} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <ExchangeRateHistory rows={historyRows} canEdit={canEdit} onDelete={deleteExchangeRate} />
        </CardContent>
      </Card>
    </div>
  );
}
