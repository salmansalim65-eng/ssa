import { describe, expect, it } from "vitest";

import { rentPeriod, rentMonthsOf, splitOverMonths } from "../rent-months";

describe("rentPeriod", () => {
  it("counts a whole month as one, both ends inclusive", () => {
    // 28 Jul – 27 Aug is the July month of a unit let on the 28th.
    expect(rentPeriod("2026-07-28", "2026-08-27")).toEqual({
      months: 1,
      remainderDays: 0,
      isPartial: false,
    });
    expect(rentPeriod("2026-08-01", "2026-08-31")).toEqual({
      months: 1,
      remainderDays: 0,
      isPartial: false,
    });
  });

  it("counts two months for a two-month letting", () => {
    // 213 SHAMAL on the August sheet.
    expect(rentPeriod("2026-07-18", "2026-09-17")).toEqual({
      months: 2,
      remainderDays: 0,
      isPartial: false,
    });
    // 607 CRECENT IMPZ.
    expect(rentPeriod("2026-07-22", "2026-09-21")).toEqual({
      months: 2,
      remainderDays: 0,
      isPartial: false,
    });
  });

  it("reports the remainder rather than rounding a part month away", () => {
    // The HH invoice already in the books: 1 Aug – 21 Sep.
    expect(rentPeriod("2026-08-01", "2026-09-21")).toEqual({
      months: 1,
      remainderDays: 21,
      isPartial: true,
    });
  });

  it("handles a month shorter than the start day", () => {
    // 31 Jan + 1 month has no 31st to land on.
    expect(rentPeriod("2026-01-31", "2026-02-28")).toEqual({
      months: 1,
      remainderDays: 0,
      isPartial: false,
    });
  });

  it("treats a period shorter than a month as one month, and says it is partial", () => {
    expect(rentPeriod("2026-08-01", "2026-08-10")).toEqual({
      months: 1,
      remainderDays: 0,
      isPartial: true,
    });
  });
});

describe("rentMonthsOf", () => {
  it("runs from the first month, one per month", () => {
    expect(rentMonthsOf("2026-08-01", 2)).toEqual(["2026-08-01", "2026-09-01"]);
    expect(rentMonthsOf("2026-11-15", 3)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});

describe("splitOverMonths", () => {
  it("divides evenly and always adds back to the whole", () => {
    expect(splitOverMonths(9000, 2)).toEqual([4500, 4500]);
    expect(splitOverMonths(7167, 2)).toEqual([3583.5, 3583.5]);
    const thirds = splitOverMonths(100, 3);
    expect(thirds).toEqual([33.33, 33.33, 33.34]);
    expect(thirds.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });

  it("leaves a single month whole", () => {
    expect(splitOverMonths(3800, 1)).toEqual([3800]);
  });
});
