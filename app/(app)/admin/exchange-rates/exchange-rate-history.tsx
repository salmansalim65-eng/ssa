"use client";

import { useMemo, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RateHistoryRow {
  id: string;
  currencyCode: string;
  rateDate: string;
  rateToBase: number;
  source: string;
}

export function ExchangeRateHistory({ rows }: { rows: RateHistoryRow[] }) {
  const [filter, setFilter] = useState("all");

  const currencyCodes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.currencyCode))).sort(),
    [rows],
  );

  const filtered = filter === "all" ? rows : rows.filter((r) => r.currencyCode === filter);

  return (
    <div className="space-y-3">
      <Select value={filter} onValueChange={setFilter}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All currencies</SelectItem>
          {currencyCodes.map((code) => (
            <SelectItem key={code} value={code}>
              {code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead>Rate to base</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.rateDate}</TableCell>
              <TableCell className="font-mono">{row.currencyCode}</TableCell>
              <TableCell>{row.rateToBase}</TableCell>
              <TableCell className="capitalize text-muted-foreground">{row.source}</TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No exchange rates recorded yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
