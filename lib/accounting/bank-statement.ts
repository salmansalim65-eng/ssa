/**
 * Reading a bank statement, whatever shape it arrives in.
 *
 * Every bank lays its statement out differently and names its columns
 * differently — Withdrawal or Debit or Dr, Particulars or Description or
 * Narration — and the same bank changes them between a PDF and a download. So
 * nothing here is told where anything is: the header row is FOUND, by what its
 * words mean, and a file with no header at all is read by what its columns
 * contain.
 *
 * Pure: no database, no clock. Strings in, rows out.
 */

/** One line of a bank statement, as the bank states it. */
export interface BankStatementLine {
  /** Row number as it appeared, so a warning can point at it. */
  rowNo: number;
  /** ISO date, or "" when the row carried none. */
  date: string;
  description: string;
  /** The bank's own reference — cheque number, transaction id. */
  reference: string;
  /** Money OUT of the account. */
  debit: number;
  /** Money INTO the account. */
  credit: number;
  warnings: string[];
}

export interface BankStatementParse {
  lines: BankStatementLine[];
  warnings: string[];
}

/* ------------------------------------------------------------- the words */

const DATE_WORDS = ["date", "txn date", "transaction date", "value date", "posting date", "tarikh"];
const DEBIT_WORDS = ["debit", "withdrawal", "withdrawals", "paid out", "dr", "payment", "outflow"];
const CREDIT_WORDS = ["credit", "deposit", "deposits", "paid in", "cr", "receipt", "inflow"];
const DESC_WORDS = ["description", "particulars", "narration", "details", "remarks", "transaction", "memo"];
const REF_WORDS = ["reference", "ref", "cheque", "cheque no", "chq", "instrument", "txn id", "voucher"];
const BALANCE_WORDS = ["balance", "running balance", "closing balance"];
const AMOUNT_WORDS = ["amount", "transaction amount"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Does this header cell mean one of these things? */
function means(cell: string, words: string[]): boolean {
  const text = norm(cell);
  if (!text) return false;
  return words.some((w) => text === w || text.startsWith(`${w} `) || text.endsWith(` ${w}`));
}

/* ------------------------------------------------------- reading a value */

/** A number as a bank writes it: "1,234.56", "(500)", "500 Dr", "–". */
export function toAmount(raw: string): number {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text) || /-\s*[\d.]/.test(text);
  const digits = text.replace(/[^0-9.]/g, "");
  if (!digits || digits === ".") return 0;
  const n = Number(digits);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date as a bank writes it.
 *
 * Day first, because every bank these statements come from writes it that way
 * — 03/10/2026 is the third of October, not the tenth of March. A month name
 * removes the doubt entirely and is read wherever it appears.
 */
export function toIsoDate(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  // Already ISO.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 03-Oct-2026, 3 October 26, Oct 3 2026.
  const named = /(\d{1,2})[\s\-/]*([a-zA-Z]{3,})[\s\-/]*(\d{2,4})/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
    if (month >= 0) return build(Number(named[3]), month + 1, Number(named[1]));
  }
  const namedFirst = /([a-zA-Z]{3,})[\s\-/]*(\d{1,2})[\s,\-/]*(\d{2,4})/.exec(text);
  if (namedFirst) {
    const month = MONTHS.indexOf(namedFirst[1].slice(0, 3).toLowerCase());
    if (month >= 0) return build(Number(namedFirst[3]), month + 1, Number(namedFirst[2]));
  }

  // 03/10/2026 — day first.
  const numeric = /^(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})/.exec(text);
  if (numeric) return build(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));

  // An Excel serial, but only in a range that can only be a date: 2004 to 2119.
  const serial = Number(text);
  if (Number.isFinite(serial) && serial >= 38000 && serial <= 80000) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  return "";
}

function build(year: number, month: number, day: number): string {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return "";
  const full = year < 100 ? 2000 + year : year;
  return `${full}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/* ------------------------------------------------------------ the paste */

/**
 * Pasted text as a grid.
 *
 * A paste out of Excel is tab-separated; one out of a PDF is columns of spaces;
 * a CSV is commas. The separator is chosen by which one actually splits the
 * text into a consistent number of columns, rather than assumed.
 */
export function gridFromText(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n").filter((r) => r.trim());
  if (rows.length === 0) return [];

  const split = (row: string, by: "tab" | "comma" | "spaces") =>
    by === "tab"
      ? row.split("\t")
      : by === "comma"
        ? splitCsv(row)
        : row.split(/\s{2,}/);

  let best: { by: "tab" | "comma" | "spaces"; width: number } = { by: "spaces", width: 0 };
  for (const by of ["tab", "comma", "spaces"] as const) {
    // The width most rows agree on: a separator that is really there splits
    // every row the same way.
    const counts = new Map<number, number>();
    for (const r of rows) {
      const n = split(r, by).length;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    let width = 0;
    let agreed = 0;
    for (const [n, rowsAtN] of counts) {
      if (n > 1 && rowsAtN > agreed) {
        agreed = rowsAtN;
        width = n;
      }
    }
    if (width > best.width) best = { by, width };
  }
  return rows.map((r) => split(r, best.by).map((c) => c.trim()));
}

/** A CSV row, honouring quotes. */
function splitCsv(row: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (ch === '"') {
      if (quoted && row[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

/* ----------------------------------------------------------- the reading */

interface Columns {
  date: number;
  description: number;
  reference: number;
  debit: number;
  credit: number;
  amount: number;
  balance: number;
}

/** Where the header row is, and what each of its columns means. */
function findColumns(grid: string[][]): { headerRow: number; columns: Columns } | null {
  for (let r = 0; r < Math.min(grid.length, 25); r += 1) {
    const row = grid[r] ?? [];
    const columns: Columns = { date: -1, description: -1, reference: -1, debit: -1, credit: -1, amount: -1, balance: -1 };
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c] ?? "";
      if (columns.date < 0 && means(cell, DATE_WORDS)) columns.date = c;
      else if (columns.debit < 0 && means(cell, DEBIT_WORDS)) columns.debit = c;
      else if (columns.credit < 0 && means(cell, CREDIT_WORDS)) columns.credit = c;
      else if (columns.balance < 0 && means(cell, BALANCE_WORDS)) columns.balance = c;
      else if (columns.amount < 0 && means(cell, AMOUNT_WORDS)) columns.amount = c;
      else if (columns.description < 0 && means(cell, DESC_WORDS)) columns.description = c;
      else if (columns.reference < 0 && means(cell, REF_WORDS)) columns.reference = c;
    }
    // A header is a header when it names a date AND some money.
    if (columns.date >= 0 && (columns.debit >= 0 || columns.credit >= 0 || columns.amount >= 0)) {
      return { headerRow: r, columns };
    }
  }
  return null;
}

/** No header: work out the columns from what the rows hold. */
function guessColumns(grid: string[][]): Columns {
  const width = Math.max(...grid.map((r) => r.length), 0);
  const columns: Columns = { date: -1, description: -1, reference: -1, debit: -1, credit: -1, amount: -1, balance: -1 };
  const numericRight: number[] = [];

  for (let c = 0; c < width; c += 1) {
    let dates = 0;
    let numbers = 0;
    let text = 0;
    let filled = 0;
    for (const row of grid) {
      const cell = (row[c] ?? "").trim();
      if (!cell) continue;
      filled += 1;
      if (toIsoDate(cell)) dates += 1;
      else if (/^[(\-]?[\d,]+(\.\d+)?\)?$/.test(cell)) numbers += 1;
      else text += 1;
    }
    if (!filled) continue;
    if (columns.date < 0 && dates / filled > 0.6) columns.date = c;
    else if (numbers / filled > 0.6) numericRight.push(c);
    else if (columns.description < 0 && text / filled > 0.6) columns.description = c;
  }

  // Of the money columns, the LAST is almost always the running balance, and
  // the two before it are the two sides. One alone is a signed amount.
  if (numericRight.length >= 3) {
    columns.balance = numericRight[numericRight.length - 1];
    columns.debit = numericRight[numericRight.length - 3];
    columns.credit = numericRight[numericRight.length - 2];
  } else if (numericRight.length === 2) {
    columns.debit = numericRight[0];
    columns.credit = numericRight[1];
  } else if (numericRight.length === 1) {
    columns.amount = numericRight[0];
  }
  return columns;
}

/**
 * A bank statement as rows SSA can match against the ledger.
 *
 * A row with no date, or with no money on it, is not a transaction — it is a
 * heading, a carried-forward balance, a page break or a total — and is left
 * out rather than guessed at.
 */
export function parseBankStatement(grid: string[][]): BankStatementParse {
  const warnings: string[] = [];
  if (grid.length === 0) return { lines: [], warnings: ["There was nothing to read."] };

  const found = findColumns(grid);
  const columns = found?.columns ?? guessColumns(grid);
  const from = found ? found.headerRow + 1 : 0;
  if (!found) {
    warnings.push("No column headings were found, so the columns were read from the figures. Check the rows below.");
  }
  if (columns.date < 0) {
    return { lines: [], warnings: [...warnings, "No date column could be found in that statement."] };
  }

  const lines: BankStatementLine[] = [];
  for (let r = from; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const date = toIsoDate(row[columns.date] ?? "");
    if (!date) continue;

    let debit = columns.debit >= 0 ? Math.abs(toAmount(row[columns.debit] ?? "")) : 0;
    let credit = columns.credit >= 0 ? Math.abs(toAmount(row[columns.credit] ?? "")) : 0;
    if (columns.amount >= 0 && debit === 0 && credit === 0) {
      // One signed column: out of the account is negative.
      const amount = toAmount(row[columns.amount] ?? "");
      if (amount < 0) debit = -amount;
      else credit = amount;
    }
    if (debit === 0 && credit === 0) continue;

    const rowWarnings: string[] = [];
    if (debit > 0 && credit > 0) {
      rowWarnings.push("Both sides carry an amount — check which it is.");
    }

    lines.push({
      rowNo: r + 1,
      date,
      description: (row[columns.description] ?? "").trim(),
      reference: (row[columns.reference] ?? "").trim(),
      debit,
      credit,
      warnings: rowWarnings,
    });
  }

  if (lines.length === 0) warnings.push("No transactions could be read from that statement.");
  return { lines, warnings };
}
