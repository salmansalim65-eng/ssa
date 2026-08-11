import { describe, it, expect } from "vitest";

import { isRentOverdue, overdueThreshold } from "@/lib/rental/overdue";

describe("overdueThreshold (first day of the month after the due date)", () => {
  it("mid-month due date -> first of next month", () => {
    expect(overdueThreshold("2026-08-20")).toBe("2026-09-01");
  });

  it("rolls over the year in December", () => {
    expect(overdueThreshold("2026-12-05")).toBe("2027-01-01");
  });

  it("accepts an ISO timestamp and uses the date part", () => {
    expect(overdueThreshold("2026-02-15T10:00:00Z")).toBe("2026-03-01");
  });
});

describe("isRentOverdue (overdue only after the due month ends)", () => {
  const due = "2026-08-20";

  it("is Due on the due date itself", () => {
    expect(isRentOverdue(due, "2026-08-20")).toBe(false);
  });

  it("stays Due through the last day of the due month", () => {
    expect(isRentOverdue(due, "2026-08-31")).toBe(false);
  });

  it("becomes Overdue on the first day of the next month", () => {
    expect(isRentOverdue(due, "2026-09-01")).toBe(true);
  });

  it("stays Overdue well after the due month", () => {
    expect(isRentOverdue(due, "2026-10-15")).toBe(true);
  });

  it("is Due before the due date", () => {
    expect(isRentOverdue(due, "2026-08-01")).toBe(false);
  });

  it("handles a December due date crossing into the new year", () => {
    expect(isRentOverdue("2026-12-10", "2026-12-31")).toBe(false);
    expect(isRentOverdue("2026-12-10", "2027-01-01")).toBe(true);
  });

  it("treats a missing due date as not overdue", () => {
    expect(isRentOverdue("", "2027-01-01")).toBe(false);
  });
});
