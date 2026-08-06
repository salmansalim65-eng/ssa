"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AccountOption {
  id: string;
  account_name: string;
}

interface Position {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Searchable account picker: type to filter by account name (the code is never
 * shown). The dropdown renders in a portal with fixed positioning so it is
 * never clipped by a scrolling voucher grid, and flips above the field when
 * there isn't room below.
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
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = accounts.find((a) => a.id === value) ?? null;

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const below = spaceBelow >= 240 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(160, Math.min(320, below ? spaceBelow : spaceAbove));
    setPos({
      left: r.left,
      width: r.width,
      top: below ? r.bottom + 4 : undefined,
      bottom: below ? undefined : window.innerHeight - r.top + 4,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? accounts.filter((a) => a.account_name.toLowerCase().includes(q)) : accounts;
    return list.slice(0, 50);
  }, [accounts, query]);

  const dropdown =
    open && pos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
              zIndex: 60,
            }}
            className="flex flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
          >
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
            <div className="overflow-y-auto p-1">
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
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "w-full justify-between font-normal",
          !selected && "text-muted-foreground",
        )}
      >
        <span className="truncate">{selected ? selected.account_name : placeholder}</span>
        <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
      </button>
      {dropdown}
    </>
  );
}
