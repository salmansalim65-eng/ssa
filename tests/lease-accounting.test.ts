import { describe, it, expect } from "vitest";

import {
  agentRentSplit,
  pkIncomeTaxProvision,
  roundTo,
  UAE_AGENT_PCT,
  HH_AGENT_PCT,
} from "@/lib/rental/lease-accounting";

describe("agentRentSplit (SAMAD RENT share)", () => {
  it("UAE: 5% share, 95% income (Test 1)", () => {
    const { share, income } = agentRentSplit(1000, UAE_AGENT_PCT);
    expect(share).toBe(50);
    expect(income).toBe(950);
    expect(share + income).toBe(1000);
  });

  it("HH: 10% share, 90% income (Test 2)", () => {
    const { share, income } = agentRentSplit(1000, HH_AGENT_PCT);
    expect(share).toBe(100);
    expect(income).toBe(900);
    expect(share + income).toBe(1000);
  });

  it("always balances after rounding for awkward amounts", () => {
    for (const rent of [1000.1, 1234.56, 999.99, 777.77, 0.05]) {
      for (const pct of [UAE_AGENT_PCT, HH_AGENT_PCT]) {
        const { share, income } = agentRentSplit(rent, pct);
        expect(roundTo(share + income)).toBe(roundTo(rent));
      }
    }
  });
});

describe("pkIncomeTaxProvision", () => {
  it("is 10% of official rent, not monthly rent (Test 3)", () => {
    // Official Rent = 1000, Monthly Rent = 1500 -> provision 100 (from official).
    expect(pkIncomeTaxProvision(1000, 1)).toBe(100);
  });

  it("recomputes when official rent changes", () => {
    expect(pkIncomeTaxProvision(1200, 1)).toBe(120);
  });

  it("scales to the invoiced period (quarterly)", () => {
    expect(pkIncomeTaxProvision(1000, 3)).toBe(300);
  });

  it("is zero when there is no official rent", () => {
    expect(pkIncomeTaxProvision(0, 1)).toBe(0);
    expect(pkIncomeTaxProvision(NaN, 1)).toBe(0);
  });
});
