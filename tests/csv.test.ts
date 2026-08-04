import { describe, expect, it } from "vitest";

import { escapeCsvValue, toCsv } from "@/lib/reports/csv";

describe("escapeCsvValue", () => {
  it("passes plain values through untouched", () => {
    expect(escapeCsvValue("PV-000001")).toBe("PV-000001");
    expect(escapeCsvValue(42)).toBe("42");
  });

  it("renders null/undefined as an empty string", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });

  it("quotes and escapes values containing commas, quotes, or newlines", () => {
    expect(escapeCsvValue("Smith, John")).toBe('"Smith, John"');
    expect(escapeCsvValue('Say "hi"')).toBe('"Say ""hi"""');
    expect(escapeCsvValue("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("builds a header row plus one row per input", () => {
    const csv = toCsv(
      ["Voucher No", "Amount"],
      [
        ["PV-1", 100],
        ["PV-2", 200],
      ],
    );

    expect(csv).toBe("Voucher No,Amount\nPV-1,100\nPV-2,200");
  });

  it("escapes values that need it inline with the rest of the row", () => {
    const csv = toCsv(["Name"], [["Doe, Jane"]]);
    expect(csv).toBe('Name\n"Doe, Jane"');
  });
});
