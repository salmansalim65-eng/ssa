import { describe, it, expect } from "vitest";

import {
  aggregateGroup,
  computePropertyRow,
  monthlyFromCycle,
  type PropertyRowInput,
} from "@/lib/reports/property-report";

function input(over: Partial<PropertyRowInput>): PropertyRowInput {
  return {
    id: "x",
    group: "HH HOME",
    name: "213 SHAMAL",
    assetCode: "AST-1",
    country: "AE",
    propertyType: "APARTMENT",
    currencyId: null,
    currencyCode: "",
    estimatedRentMonthly: 0,
    monthlyRent: 0,
    areaSqft: 0,
    serviceRate: 0,
    serviceCharges: 0,
    commissionMonthly: 0,
    purchaseValue: 0,
    currentValue: 0,
    titleDeedValue: 0,
    titleDeedOwner: "",
    occupied: false,
    purchaseDate: null,
    valuationYear: null,
    leaseStart: null,
    leaseEnd: null,
    renewMonth: null,
    titleDeedAttachmentId: null,
    titleDeedUrl: null,
    imageCount: 0,
    images: [],
    ...over,
  };
}

describe("monthlyFromCycle", () => {
  it("normalises yearly and quarterly to monthly", () => {
    expect(monthlyFromCycle(1200, "yearly")).toBe(100);
    expect(monthlyFromCycle(300, "quarterly")).toBe(100);
    expect(monthlyFromCycle(100, "monthly")).toBe(100);
    expect(monthlyFromCycle(100, null)).toBe(100);
  });
});

describe("computePropertyRow — reference formulas", () => {
  const r = computePropertyRow(
    input({
      estimatedRentMonthly: 4100,
      monthlyRent: 2505,
      areaSqft: 525,
      serviceRate: 17.08,
      serviceCharges: 8967,
      purchaseValue: 525000,
      currentValue: 550000,
    }),
  );

  it("Yearly Rent = Monthly × 12", () => expect(r.yearlyRent).toBe(30060));
  it("Diff Est vs Yearly = Est×12 − Yearly", () => expect(r.diffEstVsYearly).toBe(19140));
  it("Sq Ft Value = Purchase / Sq Ft", () => expect(r.sqFtValue).toBe(1000));
  it("Net Rent (monthly) = Monthly Rent − Service Charges / 12", () =>
    expect(r.netRent).toBe(1757.75));
  it("Perc% = Net Rent × 12 / Current Value × 100", () => expect(r.perc).toBe(3.84));
  it("% Month = Perc% / 12", () => expect(r.percMonth).toBe(0.32));
  it("Difference Value = Current − Purchase", () => expect(r.diffValue).toBe(25000));
  it("Maintenance% = Service Charges / Yearly × 100", () => expect(r.maintenancePct).toBe(29.83));

  it("guards divide-by-zero (no area / no value)", () => {
    const z = computePropertyRow(input({ monthlyRent: 100, purchaseValue: 1000 }));
    expect(z.sqFtValue).toBe(0);
    expect(z.perc).toBe(0);
    expect(z.maintenancePct).toBe(0);
  });
});

describe("aggregateGroup — sums additive, recomputes ratios", () => {
  const a = computePropertyRow(
    input({ monthlyRent: 2505, areaSqft: 525, serviceCharges: 8967, purchaseValue: 525000, currentValue: 550000 }),
  );
  const b = computePropertyRow(
    input({ monthlyRent: 1617, areaSqft: 472, serviceCharges: 6259, purchaseValue: 425000, currentValue: 475000 }),
  );
  const g = aggregateGroup([a, b]);

  it("sums purchase and current value", () => {
    expect(g.purchaseValue).toBe(950000);
    expect(g.currentValue).toBe(1025000);
  });
  it("difference value = current − purchase", () => expect(g.diffValue).toBe(75000));
  it("sums service charges and yearly rent", () => {
    expect(g.serviceCharges).toBe(15226);
    expect(g.yearlyRent).toBe(a.yearlyRent + b.yearlyRent);
  });
  it("recomputes maintenance% from group totals", () => {
    expect(g.maintenancePct).toBe(Math.round((15226 / g.yearlyRent) * 10000) / 100);
  });
});
