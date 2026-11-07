import { describe, expect, it } from "vitest";

import { rentMonthOn, rentMonthsFor, rentPeriod, rentMonthsOf, splitOverMonths } from "../rent-months";

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
 * The rent month is the month the unit was LET. August's sheet is the one
 * exception, and a deliberate one: SSA's books open in August, so July's
 * lettings are counted there — which is what `rentMonthOn` does by never
 * letting a line fall earlier than the month its sheet is for.
 */
describe("rentMonthsFor — the agent's own sheets", () => {
  const on = (from: string, to: string, sheetMonth: string) => {
    const r = rentMonthsFor(from, to);
    return `${rentMonthOn(r.firstMonth, sheetMonth)} x${r.months}`;
  };
  const AUG = "2026-08-01";
  const SEP = "2026-09-01";

  it("reads August's sheet exactly as it was posted", () => {
    expect(on("2026-07-28", "2026-08-27", AUG)).toBe("2026-08-01 x1"); // 218 X-17 IC
    expect(on("2026-07-18", "2026-09-17", AUG)).toBe("2026-08-01 x2"); // 213 SHAMAL
    expect(on("2026-07-30", "2026-08-29", AUG)).toBe("2026-08-01 x1"); // 214 ROSE
    expect(on("2026-08-03", "2026-09-02", AUG)).toBe("2026-08-01 x1"); // 305 EMIRATES
    expect(on("2026-08-11", "2026-09-10", AUG)).toBe("2026-08-01 x1"); // 206 AYYAN
    expect(on("2026-08-01", "2026-08-31", AUG)).toBe("2026-08-01 x1"); // G09
    expect(on("2026-07-22", "2026-09-21", AUG)).toBe("2026-08-01 x2"); // 607 CRECENT
    expect(on("2026-07-31", "2026-09-30", AUG)).toBe("2026-08-01 x2"); // 501 CRECENT
  });

  it("counts September's sheet by the month each unit was let", () => {
    expect(on("2026-08-31", "2026-09-29", SEP)).toBe("2026-09-01 x1"); // 218 X-17 IC — a day early
    expect(on("2026-09-18", "2026-10-17", SEP)).toBe("2026-09-01 x1"); // 213 SHAMAL — let in Sep
    expect(on("2026-08-30", "2026-09-29", SEP)).toBe("2026-09-01 x1"); // 214 ROSE — two days early
    expect(on("2026-09-03", "2026-10-02", SEP)).toBe("2026-09-01 x1"); // 305 EMIRATES
    expect(on("2026-09-29", "2026-10-18", SEP)).toBe("2026-09-01 x1"); // 206 AYYAN — let on the 29th
    expect(on("2026-09-01", "2026-09-30", SEP)).toBe("2026-09-01 x1"); // G09
    expect(on("2026-09-22", "2026-11-21", SEP)).toBe("2026-09-01 x2"); // 607 CRECENT — Sep + Oct
    expect(on("2026-10-01", "2026-11-29", SEP)).toBe("2026-10-01 x2"); // 501 CRECENT — two months
  });

  it("keeps the rule the books were written on: 15 Nov – 15 Dec is November", () => {
    expect(on("2026-11-15", "2026-12-15", "2026-11-01")).toBe("2026-11-01 x1");
    expect(on("2026-12-16", "2027-01-16", "2026-12-01")).toBe("2026-12-01 x1");
  });

  it("asks about a letting that is not really a month, and stays quiet otherwise", () => {
    // 206 AYYAN's September line is twenty days billed as a month.
    expect(rentMonthsFor("2026-09-29", "2026-10-18").isPartial).toBe(true);
    // A day either way is the calendar, not a mistake.
    expect(rentMonthsFor("2026-08-31", "2026-09-29").isPartial).toBe(false);
    expect(rentMonthsFor("2026-10-01", "2026-11-29").isPartial).toBe(false);
  });
});
