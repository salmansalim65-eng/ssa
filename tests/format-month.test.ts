import { describe, expect, it } from "vitest";

import { MONTH_NAMES, formatMonth } from "@/lib/format";

describe("formatMonth", () => {
  it("reads the month off the stored ISO date", () => {
    expect(formatMonth("2026-09-01")).toBe("Sep 2026");
    expect(formatMonth("2026-01-01")).toBe("Jan 2026");
    expect(formatMonth("2026-12-01")).toBe("Dec 2026");
  });

  it("ignores the day, so a legacy mid-month value still reads as its month", () => {
    expect(formatMonth("2026-09-15")).toBe("Sep 2026");
  });

  it("does not shift the month across a timezone boundary", () => {
    // Parsed off the string, never through Date — an early-in-the-month date in
    // a behind-UTC timezone used to land in the previous month.
    expect(formatMonth("2026-03-01")).toBe("Mar 2026");
    expect(formatMonth("2026-01-01")).toBe("Jan 2026");
  });

  it("returns nothing for an empty or unparseable value", () => {
    expect(formatMonth("")).toBe("");
    expect(formatMonth(null)).toBe("");
    expect(formatMonth(undefined)).toBe("");
    expect(formatMonth("not a date")).toBe("");
    expect(formatMonth("2026-13-01")).toBe("");
    expect(formatMonth("2026-00-01")).toBe("");
  });

  it("offers twelve month names, January first", () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe("January");
    expect(MONTH_NAMES[11]).toBe("December");
  });
});
