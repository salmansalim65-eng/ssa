import { describe, expect, it } from "vitest";

import { gridFromText, parseBankStatement, toAmount, toIsoDate } from "../bank-statement";

describe("toIsoDate", () => {
  it("reads a bank's date day-first", () => {
    expect(toIsoDate("03/10/2026")).toBe("2026-10-03");
    expect(toIsoDate("3-10-26")).toBe("2026-10-03");
    expect(toIsoDate("2026-10-03")).toBe("2026-10-03");
  });

  it("takes a month name wherever it sits", () => {
    expect(toIsoDate("03-Oct-2026")).toBe("2026-10-03");
    expect(toIsoDate("3 October 2026")).toBe("2026-10-03");
    expect(toIsoDate("Oct 3, 2026")).toBe("2026-10-03");
  });

  it("refuses a number that is only a number", () => {
    // 3,000 is money, not the 15th of August 1908.
    expect(toIsoDate("3000")).toBe("");
    expect(toIsoDate("")).toBe("");
    expect(toIsoDate("Opening balance")).toBe("");
  });
});

describe("toAmount", () => {
  it("reads money as a bank writes it", () => {
    expect(toAmount("1,234.56")).toBe(1234.56);
    expect(toAmount("(500)")).toBe(-500);
    expect(toAmount("-500.00")).toBe(-500);
    expect(toAmount("500.00 Dr")).toBe(500);
    expect(toAmount("–")).toBe(0);
    expect(toAmount("")).toBe(0);
  });
});

describe("gridFromText", () => {
  it("splits a paste out of Excel on its tabs", () => {
    const grid = gridFromText("Date\tDescription\tDebit\n03/10/2026\tDEWA\t575");
    expect(grid).toEqual([
      ["Date", "Description", "Debit"],
      ["03/10/2026", "DEWA", "575"],
    ]);
  });

  it("splits a CSV on its commas, quotes honoured", () => {
    const grid = gridFromText('Date,Description,Debit\n03/10/2026,"DEWA, Dubai",575');
    expect(grid[1]).toEqual(["03/10/2026", "DEWA, Dubai", "575"]);
  });

  it("splits a paste out of a PDF on its runs of spaces", () => {
    const grid = gridFromText("03/10/2026   DEWA DUBAI   575.00\n05/10/2026   DU INTERNET   315.00");
    expect(grid[0]).toEqual(["03/10/2026", "DEWA DUBAI", "575.00"]);
  });
});

describe("parseBankStatement", () => {
  it("finds the header wherever the bank put it, whatever it called the columns", () => {
    const { lines, warnings } = parseBankStatement([
      ["FIRST ABU DHABI BANK"],
      ["Account 1234567890", "", "", ""],
      ["Value Date", "Particulars", "Withdrawal", "Deposit", "Running Balance"],
      ["03/10/2026", "DEWA DUBAI", "575.00", "", "1,094,180.00"],
      ["05/10/2026", "TOP LINE TRANSFER", "", "50,000.00", "1,144,180.00"],
    ]);
    expect(warnings).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ date: "2026-10-03", description: "DEWA DUBAI", debit: 575, credit: 0 });
    expect(lines[1]).toMatchObject({ date: "2026-10-05", description: "TOP LINE TRANSFER", debit: 0, credit: 50000 });
  });

  it("leaves out what is not a transaction", () => {
    const { lines } = parseBankStatement([
      ["Date", "Description", "Debit", "Credit"],
      ["", "Balance brought forward", "", "1,000,000.00"],
      ["03/10/2026", "DEWA DUBAI", "575.00", ""],
      ["", "Page 1 of 4", "", ""],
      ["05/10/2026", "No amount on this row", "", ""],
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe("DEWA DUBAI");
  });

  it("reads one signed column as both sides", () => {
    const { lines } = parseBankStatement([
      ["Date", "Narration", "Amount"],
      ["03/10/2026", "DEWA", "-575.00"],
      ["05/10/2026", "Rent received", "50,000.00"],
    ]);
    expect(lines[0]).toMatchObject({ debit: 575, credit: 0 });
    expect(lines[1]).toMatchObject({ debit: 0, credit: 50000 });
  });

  it("reads a statement with no headings at all, and says so", () => {
    const { lines, warnings } = parseBankStatement([
      ["03/10/2026", "DEWA DUBAI", "575.00", "", "1,094,180.00"],
      ["05/10/2026", "TOP LINE TRANSFER", "", "50,000.00", "1,144,180.00"],
      ["07/10/2026", "DU INTERNET", "315.00", "", "1,143,865.00"],
    ]);
    expect(warnings[0]).toMatch(/no column headings/i);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ date: "2026-10-03", debit: 575, credit: 0 });
    expect(lines[1]).toMatchObject({ date: "2026-10-05", debit: 0, credit: 50000 });
  });

  it("says when there is nothing it can read", () => {
    expect(parseBankStatement([]).warnings[0]).toMatch(/nothing to read/i);
    // It says BOTH things: it could not find headings, and without a date
    // column there is nothing to read either way.
    expect(parseBankStatement([["Some", "text"], ["with", "no dates"]]).warnings.join(" ")).toMatch(
      /no date column/i,
    );
  });
});
