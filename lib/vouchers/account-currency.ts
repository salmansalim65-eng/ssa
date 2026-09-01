import type { AccountOption } from "@/components/vouchers/account-combobox";
import type { CurrencyOption } from "@/components/vouchers/currency-select";

/**
 * Country → currency-code fallback, used only for an account that carries a
 * country but no currency of its own AND whose country no other account has
 * paired with a currency yet. The chart of accounts is always consulted first
 * (see `buildAccountCurrency`), so this is a last resort for a company whose
 * accounts of that country are all missing the currency.
 */
const FALLBACK_CURRENCY_CODE_BY_COUNTRY: Record<string, string> = {
  AE: "AED",
  PK: "PKR",
  SA: "SAR",
};

/** Resolves an account (or account id) to the currency it belongs to, or null. */
export type AccountCurrencyResolver = (accountId: string | undefined | null) => string | null;

/**
 * Builds the resolver a voucher form uses to answer "which currency does this
 * account belong to?".
 *
 * An account's currency is its own `currency_id` when set. Accounts that only
 * carry a country (e.g. the Saudi banks) borrow the currency that the chart of
 * accounts already pairs with that country, falling back to the table above.
 * An account with neither — CAPITAL, SALES, COGS, Opening Balance Equity — has
 * no currency: it is generic and stays selectable in every currency.
 */
export function buildAccountCurrency(
  accounts: AccountOption[],
  currencies: CurrencyOption[],
): AccountCurrencyResolver {
  // Learn country → currency from the accounts that carry both, so the pairing
  // follows the company's own data rather than a hard-coded assumption.
  const currencyByCountry = new Map<string, string>();
  for (const a of accounts) {
    if (a.country && a.currencyId && !currencyByCountry.has(a.country)) {
      currencyByCountry.set(a.country, a.currencyId);
    }
  }
  const idByCode = new Map(currencies.map((c) => [c.code, c.id] as const));
  const byAccountId = new Map<string, string | null>();
  for (const a of accounts) {
    const fromCountry = a.country
      ? currencyByCountry.get(a.country) ??
        idByCode.get(FALLBACK_CURRENCY_CODE_BY_COUNTRY[a.country] ?? "") ??
        null
      : null;
    byAccountId.set(a.id, a.currencyId ?? fromCountry);
  }
  return (accountId) => (accountId ? byAccountId.get(accountId) ?? null : null);
}

/**
 * The accounts a picker may offer once the voucher's currency is known: those
 * of that currency plus the generic ones (no currency of their own). `keep` is
 * the picker's current value — always offered, so an account chosen before the
 * currency settled (or on an older voucher being edited) never disappears.
 */
export function accountsForCurrency(
  accounts: AccountOption[],
  currencyId: string | undefined | null,
  currencyOf: AccountCurrencyResolver,
  keep?: string,
): AccountOption[] {
  if (!currencyId) return accounts;
  return accounts.filter((a) => {
    const c = currencyOf(a.id);
    return !c || c === currencyId || a.id === keep;
  });
}

/** A `accounting.chart_of_accounts` row as the voucher pages select it. */
export type RawAccountRow = {
  id: string;
  account_code: string;
  account_name: string;
  currency_id?: string | null;
  country?: string | null;
};

/**
 * Maps chart-of-accounts rows to the option shape the voucher pickers take,
 * carrying each account's currency and country so the forms can follow them.
 */
export function toAccountOptions(
  rows: RawAccountRow[] | null | undefined,
): (AccountOption & { account_code: string })[] {
  return (rows ?? []).map((a) => ({
    id: a.id,
    account_code: a.account_code,
    account_name: a.account_name,
    currencyId: a.currency_id ?? null,
    country: a.country ?? null,
  }));
}
