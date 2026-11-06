import type { SheetGrid } from "./xlsx";

/**
 * Making sense of the agent's sheet.
 *
 * Pure: a grid of strings in, parsed lines out. Nothing here touches a file, a
 * browser or a database, so every rule below can be tested against the real
 * August sheet rather than trusted.
 *
 * The sheet's shape, as the agent writes it:
 *
 *   DATE | 25-Aug-2026 |     | SALMAN SALIM |   | MONTH | AUGUST
 *   S.NO | UNITS | RENT | FROM | TO | MANAGEMENT | NET RENT | DEWA | ...
 *      1 | 218 X-17 IC | 3,000 | 28-Jul-26 | 27-Aug-26 | 300 | 2,700 | ...
 *        | TOTAL | 36,667 | ...
 *      8 | 106 AYYAN IC |
 *      9 | 501 CRECENT IMPZ | 16,000 | 31-Jul-26 | 30-Sep-26 | 800 | ...
 *        | TOTAL | 16,000 | ...
 *        | GRAND TOTAL | 52,667 | ... | 42,029
 *
 * The blocks are short-term first, long-term after — but that is POSITION, and
 * position is the kind of thing that changes without anybody mentioning it. So
 * the block is read from position and then CHECKED against the management rate
 * each row actually carries, and a row whose rate disagrees is flagged rather
 * than quietly filed under the wrong kind.
 */

export interface ParsedLine {
  /** The unit exactly as the sheet writes it, for mapping and for the record. */
  sheetUnit: string;
  lineType: "short_term" | "long_term";
  periodFrom: string;
  periodTo: string;
  rentAmount: number;
  managementAmount: number;
  dewa: number;
  internet: number;
  accessCard: number;
  wifi: number;
  other: number;
  /** Net as the SHEET states it, for checking against what we work out. */
  sheetNet: number | null;
  /** Anything about this row a person should look at before saving. */
  warnings: string[];
}

export interface ParsedSheet {
  statementDate: string | null;
  lines: ParsedLine[];
  /** The sheet's own GRAND TOTAL net, for the tally check. */
  grandTotalNet: number | null;
  /** Anything about the sheet as a whole a person should look at. */
  warnings: string[];
}

/* ------------------------------------------------------------------ cells */

/** "3,000" / "3000.5" / "" → a number. Anything unreadable is 0. */
export function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date cell → ISO, or "" when the cell holds no date.
 *
 * Excel writes a date as a day count from 30 December 1899, with no hint in
 * the cell that it IS a date — that lives in the styles. Rather than read the
 * styles, a bare number in a plausible range is taken as a serial: 20000 is
 * 1954 and 80000 is 2119, so nothing anybody would type as a rent figure can
 * be mistaken for one. Text dates ("28-Jul-26") are read directly.
 */
export function toIsoDate(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial < 20000 || serial > 80000) return "";
    const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  // 28-Jul-26, 28 Jul 2026, 28/07/2026
  const named = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/.exec(raw);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
    if (month >= 0) {
      const year = Number(named[3]) < 100 ? 2000 + Number(named[3]) : Number(named[3]);
      return `${year}-${String(month + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
    }
  }
  const numeric = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(raw);
  if (numeric) {
    const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return "";
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/* ------------------------------------------------------------------ sheet */

/** Column positions, found by their headings rather than assumed. */
interface Columns {
  unit: number;
  rent: number;
  from: number;
  to: number;
  management: number;
  dewa: number;
  internet: number;
  accessCard: number;
  wifi: number;
  other: number;
  net: number;
}

function findHeader(grid: SheetGrid): { row: number; columns: Columns } | null {
  for (let r = 0; r < Math.min(grid.length, 30); r += 1) {
    const cells = (grid[r] ?? []).map(norm);
    const unit = cells.findIndex((c) => c === "units" || c === "unit");
    const rent = cells.findIndex((c) => c === "rent");
    if (unit < 0 || rent < 0) continue;
    const at = (...names: string[]) => cells.findIndex((c) => names.includes(c));
    return {
      row: r,
      columns: {
        unit,
        rent,
        from: at("from"),
        to: at("to"),
        management: at("management", "manageme nt", "mgmt"),
        dewa: at("dewa"),
        internet: at("internet"),
        accessCard: at("acess card", "access card"),
        wifi: at("wifi"),
        other: at("other"),
        net: at("net"),
      },
    };
  }
  return null;
}

const MANAGEMENT_RATE = { short_term: 0.1, long_term: 0.05 };

/**
 * Read the agent's sheet.
 *
 * Rows before the first TOTAL are short-term, rows after it long-term. A row
 * with no unit name, or with no rent and no deductions, is skipped: the sheet
 * carries blank rows for units that were empty that month, and an empty row is
 * not a letting.
 */
export function parseStatementSheet(grid: SheetGrid): ParsedSheet {
  const header = findHeader(grid);
  if (!header) {
    return {
      statementDate: null,
      lines: [],
      grandTotalNet: null,
      warnings: ["Could not find the heading row — is this the agent's rent sheet?"],
    };
  }
  const { columns: col } = header;

  // The statement date sits above the headings, next to a cell saying DATE.
  let statementDate: string | null = null;
  for (let r = 0; r < header.row; r += 1) {
    const cells = grid[r] ?? [];
    const i = cells.findIndex((c) => norm(c) === "date");
    if (i < 0) continue;
    for (let c = i + 1; c < Math.min(cells.length, i + 4); c += 1) {
      const iso = toIsoDate(cells[c]);
      if (iso) {
        statementDate = iso;
        break;
      }
    }
    if (statementDate) break;
  }

  const warnings: string[] = [];
  const lines: ParsedLine[] = [];
  let block: "short_term" | "long_term" = "short_term";
  let grandTotalNet: number | null = null;

  for (let r = header.row + 1; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const unit = (cells[col.unit] ?? "").trim();
    const label = norm(unit);

    if (label === "grand total") {
      grandTotalNet = col.net >= 0 ? toNumber(cells[col.net]) : null;
      continue;
    }
    if (label === "total") {
      // The first TOTAL closes the short-term block; what follows is long term.
      block = "long_term";
      continue;
    }
    if (!unit) continue;

    const rent = toNumber(cells[col.rent]);
    const management = col.management >= 0 ? toNumber(cells[col.management]) : 0;
    const dewa = col.dewa >= 0 ? toNumber(cells[col.dewa]) : 0;
    const internet = col.internet >= 0 ? toNumber(cells[col.internet]) : 0;
    const accessCard = col.accessCard >= 0 ? toNumber(cells[col.accessCard]) : 0;
    const wifi = col.wifi >= 0 ? toNumber(cells[col.wifi]) : 0;
    const other = col.other >= 0 ? toNumber(cells[col.other]) : 0;

    // A unit listed with nothing against it was empty that month, not let.
    if (rent === 0 && management + dewa + internet + accessCard + wifi + other === 0) continue;

    const rowWarnings: string[] = [];
    const rate = rent > 0 ? management / rent : null;
    if (rate !== null && management > 0 && Math.abs(rate - MANAGEMENT_RATE[block]) > 0.005) {
      const other = block === "short_term" ? "long_term" : "short_term";
      rowWarnings.push(
        Math.abs(rate - MANAGEMENT_RATE[other]) <= 0.005
          ? `Management is ${(rate * 100).toFixed(1)}% — that looks like the ${other === "long_term" ? "long" : "short"}-term rate; check the type`
          : `Management is ${(rate * 100).toFixed(1)}%, not the usual ${(MANAGEMENT_RATE[block] * 100).toFixed(0)}%`,
      );
    }

    const from = col.from >= 0 ? toIsoDate(cells[col.from]) : "";
    const to = col.to >= 0 ? toIsoDate(cells[col.to]) : "";
    if (!from || !to) rowWarnings.push("No dates on this row — the rent month cannot be worked out");

    const sheetNet = col.net >= 0 ? toNumber(cells[col.net]) : null;
    const workedOut = rent - management - (dewa + internet + accessCard + wifi + other);
    if (sheetNet !== null && Math.abs(Math.round((workedOut - sheetNet) * 100) / 100) >= 0.005) {
      rowWarnings.push(`Net on the sheet is ${sheetNet}, but the columns come to ${workedOut.toFixed(2)}`);
    }

    lines.push({
      sheetUnit: unit,
      lineType: block,
      periodFrom: from,
      periodTo: to,
      rentAmount: rent,
      managementAmount: management,
      dewa,
      internet,
      accessCard,
      wifi,
      other,
      sheetNet,
      warnings: rowWarnings,
    });
  }

  if (lines.length === 0) warnings.push("No rows with any figures on them were found.");
  return { statementDate, lines, grandTotalNet, warnings };
}
