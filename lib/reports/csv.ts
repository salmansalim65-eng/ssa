export function escapeCsvValue(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => string | number | null | undefined;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [
    columns.map((c) => escapeCsvValue(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => escapeCsvValue(c.accessor(row))).join(",")),
  ];
  return lines.join("\n");
}
