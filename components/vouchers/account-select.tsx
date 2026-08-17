"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAccountCode } from "@/lib/format";

export interface AccountOption {
  id: string;
  account_code: string;
  account_name: string;
}

export function AccountSelect({
  accounts,
  value,
  onValueChange,
  placeholder = "Select an account",
}: {
  accounts: AccountOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {formatAccountCode(account.account_code)} — {account.account_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
