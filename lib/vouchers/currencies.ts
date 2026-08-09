import "server-only";

import { createClient } from "@/lib/supabase/server";

/** A currency option for a voucher form: id, code, and its conversion-to-base rate. */
export type VoucherCurrencyOption = { id: string; code: string; rate: number };

/** Raw `core.company_currencies` row shape (with the base flag) as selected by the voucher pages. */
export type RawCompanyCurrency = {
  is_base_currency: boolean;
  currencies: { id: string; code: string } | null;
};

/**
 * Maps the company's active currencies to voucher options, ordered so the
 * SYSTEM BASE CURRENCY comes first. Every voucher form defaults its currency to
 * `currencies[0]`, so base-first ordering makes the default follow whatever the
 * administrator has configured as the base currency (dynamic — nothing is
 * hard-coded). Each option carries its conversion-to-base rate as of `asOfDate`,
 * used to seed the "Currency Conv." field.
 *
 * Pass the rows already fetched by the page (so the base flag select is the only
 * page change needed); the rate lookup runs here.
 */
export async function mapVoucherCurrencies(
  companyId: string,
  asOfDate: string,
  rows: RawCompanyCurrency[] | null | undefined,
): Promise<VoucherCurrencyOption[]> {
  const supabase = await createClient();
  const valid = (rows ?? []).filter((cc) => cc.currencies);
  // Base currency first; the rest alphabetically by code for a stable order.
  valid.sort((a, b) => {
    if (a.is_base_currency !== b.is_base_currency) return a.is_base_currency ? -1 : 1;
    return a.currencies!.code.localeCompare(b.currencies!.code);
  });

  return Promise.all(
    valid.map(async (cc) => {
      const { data: rate } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
        p_company_id: companyId,
        p_currency_id: cc.currencies!.id,
        p_as_of_date: asOfDate,
      });
      return { id: cc.currencies!.id, code: cc.currencies!.code, rate: (rate as number | null) ?? 1 };
    }),
  );
}
