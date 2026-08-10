"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ReportCountryOption {
  code: string;
  name: string;
}

const ALL = "all";

/**
 * Country selector for the accounting reports. Sets/clears the `country` query
 * param (preserving date/other params) so the server component can filter ledger
 * lines by their cost center's country.
 *
 * When `currencyOptions` is supplied, picking a country also switches the report
 * currency (`cur`) to that country's currency — matched by ISO code prefix
 * (PK→PKR, SA→SAR, AE→AED). "All countries" clears `cur` back to base.
 */
export function ReportCountryFilter({
  countries,
  selected,
  currencyOptions = [],
}: {
  countries: ReportCountryOption[];
  selected: string;
  currencyOptions?: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setCountry(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ALL) {
      params.set("country", value);
      // Auto-select the currency whose ISO code starts with the country code.
      const match = currencyOptions.find((c) => c.label.toUpperCase().startsWith(value.toUpperCase()));
      if (match) params.set("cur", match.value);
      else params.delete("cur");
    } else {
      params.delete("country");
      params.delete("cur");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="w-52 space-y-1 print:hidden">
      <Label>Country</Label>
      <Select value={selected || ALL} onValueChange={setCountry}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All countries</SelectItem>
          {countries.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
