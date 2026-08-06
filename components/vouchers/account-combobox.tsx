"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AccountOption {
  id: string;
  account_name: string;
}

/**
 * Searchable account picker: type to filter by account name. The account code
 * is intentionally never shown — users pick accounts by name only.
 */
export function AccountCombobox({
  accounts,
  value,
  onValueChange,
  placeholder = "Search account by name",
}: {
  accounts: AccountOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = accounts.find((a) => a.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? accounts.filter((a) => a.account_name.toLowerCase().includes(q)) : accounts;
    return list.slice(0, 50);
  }, [accounts, query]);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground")}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{selected ? selected.account_name : placeholder}</span>
        <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center gap-2 border-b px-2">
            <SearchIcon className="size-4 shrink-0 opacity-50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">No account found.</p>
            )}
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onValueChange(a.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                  a.id === value && "bg-accent/50",
                )}
              >
                <span className="truncate">{a.account_name}</span>
                {a.id === value && <CheckIcon className="size-4 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
