import { describe, expect, it } from "vitest";

import { aggregateByAccount } from "@/lib/reports/account-aggregation";

describe("aggregateByAccount", () => {
  it("sums debit/credit per account across multiple lines", () => {
    const result = aggregateByAccount([
      { account_id: "a1", account_code: "1000", account_name: "Cash", account_type: "asset", debit_amount: 100, credit_amount: 0 },
      { account_id: "a1", account_code: "1000", account_name: "Cash", account_type: "asset", debit_amount: 0, credit_amount: 40 },
      { account_id: "a2", account_code: "4000", account_name: "Rental Income", account_type: "income", debit_amount: 0, credit_amount: 60 },
    ]);

    expect(result.get("a1")).toEqual({
      account_code: "1000",
      account_name: "Cash",
      account_type: "asset",
      debit: 100,
      credit: 40,
    });
    expect(result.get("a2")).toEqual({
      account_code: "4000",
      account_name: "Rental Income",
      account_type: "income",
      debit: 0,
      credit: 60,
    });
    expect(result.size).toBe(2);
  });

  it("returns an empty map for no lines", () => {
    expect(aggregateByAccount([]).size).toBe(0);
  });
});
