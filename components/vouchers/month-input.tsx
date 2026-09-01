"use client";

import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MONTH_NAMES } from "@/lib/format";

const NONE = "none";

/** Reads the year and month off the stored ISO date without going through Date. */
function parseMonth(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})/.exec(value ?? "");
  return { year: match?.[1] ?? "", month: match?.[2] ?? "" };
}

/**
 * Picks a rent month by NAME — "September" + a year — instead of a calendar
 * date. The value stays the ISO date the month is stored as (its first day,
 * e.g. `2026-09-01`), so the voucher schemas and the `rent_month` date column
 * are unchanged.
 *
 * The year is a field of its own rather than part of the month list, so the
 * dropdown stays twelve entries long instead of one per month per year.
 */
export function MonthInput({
  value,
  onChange,
  yearsBack = 3,
  yearsForward = 3,
}: {
  value?: string;
  onChange: (value: string) => void;
  yearsBack?: number;
  yearsForward?: number;
}) {
  const { year: valueYear, month } = parseMonth(value);
  const currentYear = new Date().getFullYear();
  // A year on its own is not a rent month, so nothing is written until a month
  // is picked too — until then the year shown is held here. Once the field has
  // a value the year comes from it, so the two can never drift apart.
  const [pendingYear, setPendingYear] = useState(String(currentYear));
  const year = valueYear || pendingYear;

  const years = new Set<string>();
  for (let y = currentYear - yearsBack; y <= currentYear + yearsForward; y++) years.add(String(y));
  // An older voucher keeps its own year even when it falls outside the window.
  if (valueYear) years.add(valueYear);
  const yearOptions = [...years].sort();

  const emit = (nextMonth: string, nextYear: string) =>
    onChange(nextMonth ? `${nextYear}-${nextMonth}-01` : "");

  return (
    <div className="flex gap-1">
      <Select
        value={month || NONE}
        onValueChange={(v) => {
          // Clearing the month clears the value, so keep the year on screen.
          setPendingYear(year);
          emit(v === NONE ? "" : v, year);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— None —</SelectItem>
          {MONTH_NAMES.map((name, index) => (
            <SelectItem key={name} value={String(index + 1).padStart(2, "0")}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={year}
        onValueChange={(v) => {
          setPendingYear(v);
          if (month) emit(month, v);
        }}
      >
        <SelectTrigger className="w-24 shrink-0">
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent>
          {yearOptions.map((y) => (
            <SelectItem key={y} value={y}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
