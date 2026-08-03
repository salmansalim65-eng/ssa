"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AccountOption {
  id: string;
  account_code: string;
  account_name: string;
}

export function GeneralLedgerFilters({
  accounts,
  defaultAccountId,
  defaultFrom,
  defaultTo,
}: {
  accounts: AccountOption[];
  defaultAccountId: string;
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    if (accountId) params.set("accountId", accountId);
    else params.delete("accountId");
    params.set("from", from);
    params.set("to", to);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="w-64 space-y-1">
        <Label>Account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.account_code} — {a.account_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="gl-from">From</Label>
        <Input id="gl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="gl-to">To</Label>
        <Input id="gl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Button size="sm" onClick={apply}>
        Apply
      </Button>
    </div>
  );
}
