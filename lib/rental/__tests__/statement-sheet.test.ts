import { describe, expect, it } from "vitest";

import { parseStatementSheet, toIsoDate, toNumber } from "../statement-sheet";
import type { SheetGrid } from "../xlsx";

/**
 * The August 2026 sheet, cell for cell, as the agent sends it — dates as the
 * Excel serials the file really holds, not as the strings it displays.
 */
const AUGUST: SheetGrid = [
  ["DATE", "", "46259", "", "", "SALMAN SALIM", "", "", "", "", "MONTH", "", "AUGUST"],
  ["S.NO", "UNITS", "RENT", "FROM", "TO", "MANAGEMENT", "NET RENT", "DEWA", "INTERNET", "ACESS CARD", "WIFI", "OTHER", "NET", "PAID", "BALANCE"],
  ["1", "218 X-17 IC", "3000", "46231", "46261", "300", "2700", "", "", "", "", "450", "2250", "", "2250"],
  ["2", "213 SHAMAL", "9000", "46221", "46282", "900", "8100", "1072", "", "", "629", "150", "6249", "", "6249"],
  ["3", "214 ROSE EGL", "3000", "46238", "46268", "300", "2700", "535", "", "", "", "170", "1995", "", "1995"],
  ["4", "305 EMIRATES GARDEN", "3800", "46237", "46267", "380", "3420", "", "", "", "", "", "3420", "", "3420"],
  ["5", "206 AYYAN IC", "4200", "46245", "46275", "420", "3780", "", "", "", "", "", "3780", "", "3780"],
  ["6", "G09, SEASON JVC", "6500", "46235", "46265", "650", "5850", "557", "", "", "315", "", "4978", "", "4978"],
  ["7", "607 CRECENT IMPZ", "7167", "46225", "46286", "717", "6450", "900", "", "", "315", "1078", "4157", "", "4157"],
  ["", "TOTAL", "36667", "", "", "3667", "33000", "3064", "0", "0", "1259", "1848", "26829", "0", "26829"],
  [],
  ["8", "106 AYYAN IC", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["9", "501 CRECENT IMPZ", "16000", "46234", "46295", "800", "15200", "", "", "", "", "", "15200", "", "15200"],
  ["", "TOTAL", "16000", "", "", "800", "15200", "0", "0", "0", "0", "0", "15200", "0", "15200"],
  ["", "GRAND TOTAL", "52667", "", "", "4467", "48200", "3064", "0", "0", "1259", "1848", "42029", "0", "42029"],
];

describe("toNumber", () => {
  it("reads the figures a sheet writes", () => {
    expect(toNumber("3,000")).toBe(3000);
    expect(toNumber("716.70")).toBe(716.7);
    expect(toNumber("")).toBe(0);
    expect(toNumber("n/a")).toBe(0);
  });
});

describe("toIsoDate", () => {
  it("reads an Excel serial", () => {
    expect(toIsoDate("46259")).toBe("2026-08-25");
    expect(toIsoDate("46231")).toBe("2026-07-28");
  });

  it("reads the text forms a sheet might carry", () => {
    expect(toIsoDate("28-Jul-26")).toBe("2026-07-28");
    expect(toIsoDate("28/07/2026")).toBe("2026-07-28");
    expect(toIsoDate("2026-07-28")).toBe("2026-07-28");
  });

  it("refuses a number that is not a plausible date", () => {
    // A rent figure must never be mistaken for a date.
    expect(toIsoDate("3000")).toBe("");
    expect(toIsoDate("9000")).toBe("");
    expect(toIsoDate("")).toBe("");
  });
});

describe("parseStatementSheet", () => {
  const sheet = parseStatementSheet(AUGUST);

  it("finds the statement date above the headings", () => {
    expect(sheet.statementDate).toBe("2026-08-25");
  });

  it("reads every row that has figures, and no TOTAL row", () => {
    expect(sheet.lines.map((l) => l.sheetUnit)).toEqual([
      "218 X-17 IC",
      "213 SHAMAL",
      "214 ROSE EGL",
      "305 EMIRATES GARDEN",
      "206 AYYAN IC",
      "G09, SEASON JVC",
      "607 CRECENT IMPZ",
      "501 CRECENT IMPZ",
    ]);
  });

  it("skips a unit listed with nothing against it", () => {
    // 106 AYYAN IC is on the sheet but was not let.
    expect(sheet.lines.some((l) => l.sheetUnit === "106 AYYAN IC")).toBe(false);
  });

  it("puts the first block on short term and the second on long", () => {
    expect(sheet.lines.filter((l) => l.lineType === "short_term")).toHaveLength(7);
    expect(sheet.lines.filter((l) => l.lineType === "long_term").map((l) => l.sheetUnit)).toEqual([
      "501 CRECENT IMPZ",
    ]);
  });

  it("reads a row's figures and dates", () => {
    const shamal = sheet.lines.find((l) => l.sheetUnit === "213 SHAMAL")!;
    expect(shamal).toMatchObject({
      periodFrom: "2026-07-18",
      periodTo: "2026-09-17",
      rentAmount: 9000,
      managementAmount: 900,
      dewa: 1072,
      wifi: 629,
      other: 150,
      sheetNet: 6249,
    });
    expect(shamal.warnings).toEqual([]);
  });

  it("takes the sheet's rounded management without complaint", () => {
    // 7,167 at 10% is 716.70; the agent writes 717, and 717/7167 is 10.004%.
    const crecent = sheet.lines.find((l) => l.sheetUnit === "607 CRECENT IMPZ")!;
    expect(crecent.managementAmount).toBe(717);
    expect(crecent.warnings).toEqual([]);
  });

  it("picks up the grand total for the tally check", () => {
    expect(sheet.grandTotalNet).toBe(42029);
  });

  it("adds up to the sheet's own total", () => {
    const net = sheet.lines.reduce(
      (s, l) =>
        s + l.rentAmount - l.managementAmount - (l.dewa + l.internet + l.accessCard + l.wifi + l.other),
      0,
    );
    expect(net).toBe(sheet.grandTotalNet);
  });

  it("flags a management rate that belongs to the other kind of line", () => {
    const wrong = parseStatementSheet([
      AUGUST[1],
      // 5% on a row sitting in the short-term block.
      ["1", "218 X-17 IC", "3000", "46231", "46261", "150", "2850", "", "", "", "", "", "2850", "", ""],
    ]);
    expect(wrong.lines[0].warnings[0]).toMatch(/long-term rate/);
  });

  it("flags a row whose own net does not add up", () => {
    const wrong = parseStatementSheet([
      AUGUST[1],
      ["1", "218 X-17 IC", "3000", "46231", "46261", "300", "2700", "", "", "", "", "450", "9999", "", ""],
    ]);
    expect(wrong.lines[0].warnings.some((w) => w.includes("9999"))).toBe(true);
  });

  it("says so rather than guessing when the sheet is not the sheet", () => {
    const nonsense = parseStatementSheet([["hello"], ["world"]]);
    expect(nonsense.lines).toHaveLength(0);
    expect(nonsense.warnings[0]).toMatch(/heading row/);
  });
});
