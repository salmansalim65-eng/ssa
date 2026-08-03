import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { AddCurrencyDialog } from "./add-currency-dialog";
import { CurrenciesTable, type CurrencyRow } from "./currencies-table";

export default async function CurrenciesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: currencies }, { data: companyCurrencies }, canCreate, canEdit] =
    await Promise.all([
      supabase.schema("core").from("currencies").select("*").order("code"),
      supabase
        .schema("core")
        .from("company_currencies")
        .select("currency_id, is_active, is_base_currency")
        .eq("company_id", companyId),
      hasPermission("currencies", "create"),
      hasPermission("currencies", "edit"),
    ]);

  const byCurrency = new Map(companyCurrencies?.map((cc) => [cc.currency_id, cc]));

  const rows: CurrencyRow[] = (currencies ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    decimal_places: c.decimal_places,
    isEnabled: byCurrency.get(c.id)?.is_active ?? false,
    isBase: byCurrency.get(c.id)?.is_base_currency ?? false,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Currencies</h1>
          <p className="text-sm text-muted-foreground">
            Shared across every company. Enable the ones you transact in and
            pick one base currency.
          </p>
        </div>
        {canCreate && <AddCurrencyDialog />}
      </div>
      <CurrenciesTable rows={rows} canEdit={canEdit} />
    </div>
  );
}
