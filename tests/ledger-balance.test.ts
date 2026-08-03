import { describe, expect, it } from "vitest";

import { computeRunningBalances } from "@/lib/reports/ledger-balance";

describe("computeRunningBalances", () => {
  it("accumulates debit-normal balances (asset/expense accounts)", () => {
    const result = computeRunningBalances(100, true, [
      { debit_amount: 50, credit_amount: 0 },
      { debit_amount: 0, credit_amount: 30 },
      { debit_amount: 20, credit_amount: 0 },
    ]);

    expect(result.map((r) => r.balance)).toEqual([150, 120, 140]);
  });

  it("accumulates credit-normal balances (liability/equity/income accounts)", () => {
    const result = computeRunningBalances(0, false, [
      { debit_amount: 0, credit_amount: 100 },
      { debit_amount: 40, credit_amount: 0 },
    ]);

    expect(result.map((r) => r.balance)).toEqual([100, 60]);
  });

  it("returns an empty array for no lines, without touching the opening balance", () => {
    expect(computeRunningBalances(500, true, [])).toEqual([]);
  });

  it("preserves the original line fields alongside the computed balance", () => {
    const [row] = computeRunningBalances(0, true, [
      { debit_amount: 10, credit_amount: 0, voucher_no: "PV-000001" },
    ]);

    expect(row).toEqual({ debit_amount: 10, credit_amount: 0, voucher_no: "PV-000001", balance: 10 });
  });
});
