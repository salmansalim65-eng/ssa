"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface CurrencyOption {
  id: string;
  code: string;
}

export function CurrencySelect({
  currencies,
  value,
  onValueChange,
}: {
  currencies: CurrencyOption[];
  value?: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select currency" />
      </SelectTrigger>
      <SelectContent>
        {currencies.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
