import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface ResolvedReportCurrency {
  /** Symbol of the selected currency (falls back to its code, then ""). */
  symbol: string;
  /** Multiply a base-currency amount by this to get the selected currency. */
  factor: number;
  /** Selected currency code, for the header note. */
  selectedCode: string;
  /** Base currency code (null when none is configured). */
  baseCode: string | null;
  /** Options for a currency <select>, base first then alphabetical. */
  options: { value: string; label: string }[];
}

/**
 * Resolves the currency a report should display in. Ledger amounts are stored in
 * the company base currency; when `cur` names another active currency, every
 * figure is converted at that currency's rate as of `asOfDate` (via
 * fn_exchange_rate_to_base). An unset `cur`, or a missing rate, leaves amounts in
 * base. Shared by the Cash Book / Bank Book reports.
 */
export async function resolveReportCurrency(
  companyId: string,
  cur: string,
  asOfDate: string,
): Promise<ResolvedReportCurrency> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("core")
    .from("company_currencies")
    .select("is_base_currency, currencies:currency_id(id, code, symbol)")
    .eq("company_id", companyId)
    .eq("is_active", true);

  type Raw = { is_base_currency: boolean; currencies: { id: string; code: string; symbol: string } | null };
  const list = ((data as unknown as Raw[]) ?? []).filter((c) => c.currencies);
  const base = list.find((c) => c.is_base_currency)?.currencies ?? null;
  const options = list
    .map((c) => ({ value: c.currencies!.id, label: c.currencies!.code }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const selectedId = cur || base?.id || "";
  const selected = list.find((c) => c.currencies!.id === selectedId)?.currencies ?? base;

  let factor = 1;
  if (selectedId && base && selectedId !== base.id) {
    const { data: rate, error } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
      p_company_id: companyId,
      p_currency_id: selectedId,
      p_as_of_date: asOfDate,
    });
    if (!error && rate) factor = 1 / (rate as number);
  }

  return {
    symbol: selected?.symbol ?? selected?.code ?? "",
    factor,
    selectedCode: selected?.code ?? "",
    baseCode: base?.code ?? null,
    options,
  };
}

export interface ResolvedRentalCurrency {
  symbol: string;
  selectedCode: string;
  baseCode: string | null;
  options: { value: string; label: string }[];
  /** Converts an amount held in `fromCode` document currency into the selected
   * report currency, going via base (base = amount × rateToBase(from); selected
   * = base ÷ rateToBase(selected)). Unknown currencies pass through unconverted. */
  convert: (amount: number, fromCode: string) => number;
}

/**
 * Currency resolver for reports whose rows carry per-invoice document-currency
 * amounts (Rental Income, Outstanding Rent) rather than base-currency ledger
 * figures. Pre-fetches every active currency's rate to base as of `asOfDate` so
 * the returned `convert` is synchronous.
 */
export async function resolveRentalReportCurrency(
  companyId: string,
  cur: string,
  asOfDate: string,
): Promise<ResolvedRentalCurrency> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("core")
    .from("company_currencies")
    .select("is_base_currency, currencies:currency_id(id, code, symbol)")
    .eq("company_id", companyId)
    .eq("is_active", true);

  type Raw = { is_base_currency: boolean; currencies: { id: string; code: string; symbol: string } | null };
  const list = ((data as unknown as Raw[]) ?? []).filter((c) => c.currencies);
  const base = list.find((c) => c.is_base_currency)?.currencies ?? null;
  const options = list
    .map((c) => ({ value: c.currencies!.id, label: c.currencies!.code }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const selectedId = cur || base?.id || "";
  const selected = list.find((c) => c.currencies!.id === selectedId)?.currencies ?? base;

  // Rate to base for every currency (base = amount × rate). Base currency is 1.
  const rateByCode = new Map<string, number>();
  await Promise.all(
    list.map(async (c) => {
      const code = c.currencies!.code;
      if (c.is_base_currency) {
        rateByCode.set(code, 1);
        return;
      }
      const { data: rate, error } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
        p_company_id: companyId,
        p_currency_id: c.currencies!.id,
        p_as_of_date: asOfDate,
      });
      rateByCode.set(code, !error && rate ? (rate as number) : 1);
    }),
  );

  const selectedRate = selected ? rateByCode.get(selected.code) ?? 1 : 1;

  return {
    symbol: selected?.symbol ?? selected?.code ?? "",
    selectedCode: selected?.code ?? "",
    baseCode: base?.code ?? null,
    options,
    convert: (amount: number, fromCode: string) => {
      const rateFrom = rateByCode.get(fromCode) ?? 1;
      return (amount * rateFrom) / (selectedRate || 1);
    },
  };
}
