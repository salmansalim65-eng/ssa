"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VOUCHER_TYPES } from "@/types/database.types";

export interface AccountOption {
  id: string;
  account_code: string;
  account_name: string;
}

export interface CurrencyChoice {
  id: string;
  code: string;
}

export interface CostCenterChoice {
  id: string;
  name: string;
}

const ACCOUNT_CURRENCY = "account";
const ALL_COST_CENTERS = "all";

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function GeneralLedgerFilters({
  accounts,
  currencies,
  baseCurrencyId = "",
  costCenters,
  defaultAccountIds,
  defaultFrom,
  defaultTo,
  defaultCurrency,
  defaultVoucherType,
  defaultCostCenter,
  defaultQuery,
  defaultMin,
  defaultMax,
  collapsedByDefault = false,
}: {
  accounts: AccountOption[];
  currencies: CurrencyChoice[];
  baseCurrencyId?: string;
  costCenters: CostCenterChoice[];
  defaultAccountIds: string[];
  defaultFrom: string;
  defaultTo: string;
  defaultCurrency: string;
  defaultVoucherType: string;
  defaultCostCenter: string;
  defaultQuery: string;
  defaultMin: string;
  defaultMax: string;
  collapsedByDefault?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [expanded, setExpanded] = useState(!collapsedByDefault);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultAccountIds));
  const [accountSearch, setAccountSearch] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [currency, setCurrency] = useState(defaultCurrency || ACCOUNT_CURRENCY);
  const [voucherType, setVoucherType] = useState(defaultVoucherType || "all");
  const [costCenter, setCostCenter] = useState(defaultCostCenter || ALL_COST_CENTERS);
  const [query, setQuery] = useState(defaultQuery);
  const [min, setMin] = useState(defaultMin);
  const [max, setMax] = useState(defaultMax);

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    const list = q
      ? accounts.filter(
          (a) => a.account_name.toLowerCase().includes(q) || a.account_code.toLowerCase().includes(q),
        )
      : accounts;
    return list.slice(0, 200);
  }, [accounts, accountSearch]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    if (selected.size) params.set("accountIds", [...selected].join(","));
    else params.delete("accountIds");
    params.delete("accountId"); // legacy single-account param
    params.set("from", from);
    params.set("to", to);
    if (currency && currency !== ACCOUNT_CURRENCY) params.set("cur", currency);
    else params.delete("cur");
    if (voucherType && voucherType !== "all") params.set("vtype", voucherType);
    else params.delete("vtype");
    if (costCenter && costCenter !== ALL_COST_CENTERS) params.set("cc", costCenter);
    else params.delete("cc");
    if (query.trim()) params.set("q", query.trim());
    else params.delete("q");
    if (min.trim()) params.set("min", min.trim());
    else params.delete("min");
    if (max.trim()) params.set("max", max.trim());
    else params.delete("max");
    setExpanded(false); // collapse so the ledger gets the full page
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="rounded-md border print:hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium hover:bg-accent"
      >
        <span>
          Filters
          {!expanded && (
            <span className="ml-2 font-normal text-muted-foreground">
              {selected.size} account{selected.size === 1 ? "" : "s"} · {from} → {to}
            </span>
          )}
        </span>
        {expanded ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
      </button>

      {expanded && (
        <div className="space-y-3 border-t p-4">
          <div className="flex flex-wrap gap-4">
        {/* Multi-account picker */}
        <div className="w-72 space-y-1">
          <Label>Accounts ({selected.size} selected)</Label>
          <Input
            placeholder="Search accounts by name…"
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
          />
          <div className="max-h-48 overflow-y-auto rounded-md border p-1">
            {filteredAccounts.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent"
              >
                <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                <span className="truncate">{a.account_name}</span>
              </label>
            ))}
            {filteredAccounts.length === 0 && (
              <p className="px-2 py-2 text-center text-sm text-muted-foreground">No account found.</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label htmlFor="gl-from">From</Label>
              <Input id="gl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gl-to">To</Label>
              <Input id="gl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="w-44 space-y-1">
              <Label>Reporting currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ACCOUNT_CURRENCY}>Account currency</SelectItem>
                  {currencies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code}
                      {c.id === baseCurrencyId ? " (base)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="w-44 space-y-1">
              <Label>Voucher type</Label>
              <Select value={voucherType} onValueChange={setVoucherType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {VOUCHER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {titleCase(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44 space-y-1">
              <Label>Cost center</Label>
              <Select value={costCenter} onValueChange={setCostCenter}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_COST_CENTERS}>All cost centers</SelectItem>
                  {costCenters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-56 space-y-1">
              <Label htmlFor="gl-q">Search (voucher / narration)</Label>
              <Input id="gl-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Contains…" />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor="gl-min">Min amount</Label>
              <Input id="gl-min" type="number" step="0.01" value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor="gl-max">Max amount</Label>
              <Input id="gl-max" type="number" step="0.01" value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

          <Button size="sm" onClick={apply}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
