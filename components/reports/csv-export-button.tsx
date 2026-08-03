"use client";

import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => string | number | null | undefined;
}

function escapeCsvValue(value: unknown) {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function CsvExportButton<T>({
  rows,
  columns,
  filename,
}: {
  rows: T[];
  columns: CsvColumn<T>[];
  filename: string;
}) {
  function exportCsv() {
    const lines = [
      columns.map((c) => escapeCsvValue(c.header)).join(","),
      ...rows.map((row) => columns.map((c) => escapeCsvValue(c.accessor(row))).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={exportCsv} className="print:hidden">
      <DownloadIcon /> Export CSV
    </Button>
  );
}
