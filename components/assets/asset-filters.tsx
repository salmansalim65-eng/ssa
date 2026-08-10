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

export interface CountryFilterOption {
  code: string;
  name: string;
}

const ALL = "all";

export function AssetFilters({
  countries,
  selectedCountry,
}: {
  countries: CountryFilterOption[];
  selectedCountry: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setCountry(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ALL) params.set("country", value);
    else params.delete("country");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="w-56 space-y-1">
        <Label>Country</Label>
        <Select value={selectedCountry || ALL} onValueChange={setCountry}>
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
    </div>
  );
}
