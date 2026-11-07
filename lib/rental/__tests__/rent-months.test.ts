import { describe, expect, it } from "vitest";

import { rentMonthsFor, rentPeriod, rentMonthsOf, splitOverMonths } from "../rent-months";

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

/**
 * The agent's real sheets, August and September 2026, line by line.
 *
 * These two together are the whole point of rounding to the nearest 1st: read
 * by start month, 213 SHAMAL and 607 CRECENT were billed for September on BOTH
 * sheets while October went unbilled. Every line below is a line off the paper.
 */
describe("rentMonthsFor — the agent's own sheets", () => {
  const months = (from: string, to: string) => {
    const r = rentMonthsFor(from, to);
    return `${r.firstMonth} x${r.months}`;
  };

  it("reads August's sheet exactly as it was posted", () => {
    expect(months("2026-07-28", "2026-08-27")).toBe("2026-08-01 x1"); // 218 X-17 IC
    expect(months("2026-07-18", "2026-09-17")).toBe("2026-08-01 x2"); // 213 SHAMAL
    expect(months("2026-07-30", "2026-08-29")).toBe("2026-08-01 x1"); // 214 ROSE
    expect(months("2026-08-03", "2026-09-02")).toBe("2026-08-01 x1"); // 305 EMIRATES
    expect(months("2026-08-11", "2026-09-10")).toBe("2026-08-01 x1"); // 206 AYYAN
    expect(months("2026-08-01", "2026-08-31")).toBe("2026-08-01 x1"); // G09
    expect(months("2026-07-22", "2026-09-21")).toBe("2026-08-01 x2"); // 607 CRECENT
    expect(months("2026-07-31", "2026-09-30")).toBe("2026-08-01 x2"); // 501 CRECENT
  });

  it("carries September's sheet on from there, with no month billed twice", () => {
    expect(months("2026-08-31", "2026-09-29")).toBe("2026-09-01 x1"); // 218 X-17 IC
    expect(months("2026-09-18", "2026-10-17")).toBe("2026-10-01 x1"); // 213 SHAMAL — Oct, not Sep again
    expect(months("2026-08-30", "2026-09-29")).toBe("2026-09-01 x1"); // 214 ROSE
    expect(months("2026-09-03", "2026-10-02")).toBe("2026-09-01 x1"); // 305 EMIRATES
    expect(months("2026-09-29", "2026-10-18")).toBe("2026-10-01 x1"); // 206 AYYAN
    expect(months("2026-09-01", "2026-09-30")).toBe("2026-09-01 x1"); // G09
    expect(months("2026-09-22", "2026-11-21")).toBe("2026-10-01 x2"); // 607 CRECENT — Oct + Nov
    expect(months("2026-10-01", "2026-11-29")).toBe("2026-10-01 x2"); // 501 CRECENT — two months, not one
  });

  it("keeps the rule the books were written on: 15 Nov – 15 Dec is November", () => {
    expect(months("2026-11-15", "2026-12-15")).toBe("2026-11-01 x1");
    expect(months("2026-12-16", "2027-01-16")).toBe("2026-12-01 x1");
  });

  it("asks about a letting that is not really a month, and stays quiet otherwise", () => {
    // 206 AYYAN's September line is twenty days billed as a month.
    expect(rentMonthsFor("2026-09-29", "2026-10-18").isPartial).toBe(true);
    // A day either way is the calendar, not a mistake.
    expect(rentMonthsFor("2026-08-31", "2026-09-29").isPartial).toBe(false);
    expect(rentMonthsFor("2026-10-01", "2026-11-29").isPartial).toBe(false);
  });
});
