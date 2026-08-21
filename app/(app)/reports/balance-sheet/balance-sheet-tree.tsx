"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface BsRow {
  id: string;
  parentId: string | null;
  depth: number;
  isGroup: boolean;
  seq: number | null;
  code: string;
  name: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface BsTotal {
  label: string;
  debit: string;
  credit: string;
  balance: string;
  emphatic?: boolean;
}

const totalRowClass = "bg-header text-header-foreground hover:bg-header [&>td]:border-header-border";

export function BalanceSheetTree({
  rows,
  profit,
  totals,
  inactiveRows,
}: {
  rows: BsRow[];
  profit: { seq: number; debit: string; credit: string; balance: string } | null;
  totals: BsTotal[];
  inactiveRows: BsRow[];
}) {
  // Groups start expanded; clicking a group row toggles its subtree.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const parentOf = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const r of [...rows, ...inactiveRows]) map.set(r.id, r.parentId);
    return map;
  }, [rows, inactiveRows]);

  // A row is hidden when any of its ancestor groups is collapsed.
  const isHidden = (r: BsRow) => {
    let p = r.parentId;
    while (p) {
      if (collapsed.has(p)) return true;
      p = parentOf.get(p) ?? null;
    }
    return false;
  };

  function renderRow(r: BsRow) {
    if (isHidden(r)) return null;
    const pad = { paddingLeft: `${0.5 + r.depth * 1.25}rem` };
    if (r.isGroup) {
      const isCollapsed = collapsed.has(r.id);
      return (
        <TableRow
          key={r.id}
          className="cursor-pointer bg-muted hover:bg-muted/80"
          onClick={() => toggle(r.id)}
        >
          <TableCell />
          <TableCell
            style={pad}
            className="font-semibold uppercase tracking-wide text-slate-900 dark:text-slate-100"
          >
            <span className="mr-1.5 inline-flex size-4 shrink-0 items-center justify-center align-middle text-muted-foreground">
              {isCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
            </span>
            {r.name}
          </TableCell>
          <TableCell className="text-right font-mono font-semibold tabular-nums">{r.debit}</TableCell>
          <TableCell className="text-right font-mono font-semibold tabular-nums">{r.credit}</TableCell>
          <TableCell className="text-right font-mono font-semibold tabular-nums">{r.balance}</TableCell>
        </TableRow>
      );
    }
    return (
      <TableRow key={r.id}>
        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{r.seq}</TableCell>
        <TableCell style={pad}>
          <span className="font-medium">{r.name}</span>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">{r.debit}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">{r.credit}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">{r.balance}</TableCell>
      </TableRow>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12 text-right">S.No</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(renderRow)}

          {profit && (
            <TableRow>
              <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{profit.seq}</TableCell>
              <TableCell className="pl-2">Current period profit/(loss)</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{profit.debit}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{profit.credit}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{profit.balance}</TableCell>
            </TableRow>
          )}

          {totals.map((t) => (
            <TableRow key={t.label} className={totalRowClass}>
              <TableCell />
              <TableCell className={t.emphatic ? "font-semibold" : "font-medium"}>{t.label}</TableCell>
              <TableCell className={cn("text-right font-mono tabular-nums", t.emphatic ? "font-semibold" : "font-medium")}>{t.debit}</TableCell>
              <TableCell className={cn("text-right font-mono tabular-nums", t.emphatic ? "font-semibold" : "font-medium")}>{t.credit}</TableCell>
              <TableCell className={cn("text-right font-mono tabular-nums", t.emphatic ? "font-semibold" : "font-medium")}>{t.balance}</TableCell>
            </TableRow>
          ))}

          {inactiveRows.length > 0 && (
            <>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableCell colSpan={5} className="pt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Inactive Accounts
                </TableCell>
              </TableRow>
              {inactiveRows.map(renderRow)}
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
