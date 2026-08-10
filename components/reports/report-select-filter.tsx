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

export interface ReportSelectOption {
  value: string;
  label: string;
}

const ALL = "all";

/**
 * Generic single-select report filter. Sets/clears one query param (preserving
 * every other param) so the server component can re-filter. Passing an empty
 * `selected` shows the `allLabel` sentinel; picking it clears the param.
 */
export function ReportSelectFilter({
  label,
  param,
  allLabel,
  options,
  selected,
  width = "w-52",
}: {
  label: string;
  param: string;
  allLabel: string;
  options: ReportSelectOption[];
  selected: string;
  width?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setValue(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ALL) params.set(param, value);
    else params.delete(param);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className={`${width} space-y-1 print:hidden`}>
      <Label>{label}</Label>
      <Select value={selected || ALL} onValueChange={setValue}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
