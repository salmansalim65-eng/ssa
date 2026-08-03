import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Thin wrapper over the core.fn_exchange_rate_to_base / fn_convert_to_base
 * RPCs — the database functions are the source of truth (and what the
 * accounting engine calls at posting time); this just gives server
 * components/actions a typed call site instead of repeating .rpc() calls.
 */
export async function getExchangeRateToBase(
  companyId: string,
  currencyId: string,
  asOfDate?: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
    p_company_id: companyId,
    p_currency_id: currencyId,
    ...(asOfDate ? { p_as_of_date: asOfDate } : {}),
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function convertToBase(
  companyId: string,
  currencyId: string,
  amount: number,
  asOfDate?: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("fn_convert_to_base", {
    p_company_id: companyId,
    p_currency_id: currencyId,
    p_amount: amount,
    ...(asOfDate ? { p_as_of_date: asOfDate } : {}),
  });

  if (error) throw new Error(error.message);
  return data;
}

export function formatMoney(amount: number, currencyCode: string, decimalPlaces: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(amount);
  } catch {
    return `${amount.toFixed(decimalPlaces)} ${currencyCode}`;
  }
}
