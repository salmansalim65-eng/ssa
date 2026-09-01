import { describe, expect, it } from "vitest";

import {
  accountsForCurrency,
  buildAccountCurrency,
  toAccountOptions,
} from "@/lib/vouchers/account-currency";

const AED = "cur-aed";
const PKR = "cur-pkr";
const SAR = "cur-sar";

const currencies = [
  { id: AED, code: "AED", rate: 1 },
  { id: PKR, code: "PKR", rate: 0.013 },
  { id: SAR, code: "SAR", rate: 0.98 },
];

const accounts = toAccountOptions([
  // Carries its own currency and a country.
  { id: "meezan", account_code: "AC-000022", account_name: "MEEZAN BANK", currency_id: PKR, country: "PK" },
  { id: "fab", account_code: "AC-000023", account_name: "FAB BANK", currency_id: AED, country: null },
  // Currency only — the many income/expense accounts.
  { id: "rent-pk", account_code: "AC-000005", account_name: "RENT INCOME PK", currency_id: PKR, country: null },
  // Country only — borrows the currency its country is paired with.
  { id: "uhf", account_code: "AC-000049", account_name: "UHF SOLUTIONS", currency_id: null, country: "PK" },
  { id: "riyad", account_code: "AC-000060", account_name: "RIYAD BANK", currency_id: null, country: "SA" },
  // Neither — a generic account, offered whatever the voucher currency is.
  { id: "capital", account_code: "AC-000019", account_name: "CAPITAL", currency_id: null, country: null },
]);

const currencyOf = buildAccountCurrency(accounts, currencies);

describe("buildAccountCurrency", () => {
  it("takes the account's own currency when it has one", () => {
    expect(currencyOf("meezan")).toBe(PKR);
    expect(currencyOf("fab")).toBe(AED);
    expect(currencyOf("rent-pk")).toBe(PKR);
  });

  it("borrows the currency the chart of accounts pairs with the country", () => {
    // No currency of its own, but MEEZAN BANK already pairs PK with PKR.
    expect(currencyOf("uhf")).toBe(PKR);
  });

  it("falls back to the country's own currency when no account pairs them", () => {
    // Nothing in this chart pairs SA with a currency.
    expect(currencyOf("riyad")).toBe(SAR);
  });

  it("leaves an account with neither country nor currency generic", () => {
    expect(currencyOf("capital")).toBeNull();
    expect(currencyOf(undefined)).toBeNull();
    expect(currencyOf("no-such-account")).toBeNull();
  });
});

describe("accountsForCurrency", () => {
  const ids = (list: { id: string }[]) => list.map((a) => a.id);

  it("offers the currency's accounts plus the generic ones", () => {
    expect(ids(accountsForCurrency(accounts, PKR, currencyOf))).toEqual([
      "meezan",
      "rent-pk",
      "uhf",
      "capital",
    ]);
    expect(ids(accountsForCurrency(accounts, AED, currencyOf))).toEqual(["fab", "capital"]);
  });

  it("keeps the picker's own account even when it is off-currency", () => {
    expect(ids(accountsForCurrency(accounts, AED, currencyOf, "meezan"))).toEqual([
      "meezan",
      "fab",
      "capital",
    ]);
  });

  it("offers everything until the voucher has a currency", () => {
    expect(ids(accountsForCurrency(accounts, "", currencyOf))).toEqual(ids(accounts));
  });
});
