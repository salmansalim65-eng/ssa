"use client";

import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toCsv, type CsvCell } from "@/lib/reports/csv";

export function CsvExportButton({
  headers,
  rows,
  filename,
}: {
  headers: string[];
  rows: CsvCell[][];
  filename: string;
}) {
  function exportCsv() {
    const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8;" });
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
