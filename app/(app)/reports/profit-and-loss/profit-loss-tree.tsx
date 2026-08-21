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

export interface PlRow {
  id: string;
  parentId: string | null;
  depth: number;
  isGroup: boolean;
  seq: number | null;
  code: string;
  name: string;
  debit: string;
  credit: string;
  amount: string;
}

interface SectionTotal {
  debit: string;
  credit: string;
  amount: string;
}

const totalRowClass = "bg-header text-header-foreground hover:bg-header [&>td]:border-header-border";

export function ProfitLossTree({
  income,
  expense,
  incomeTotal,
  expenseTotal,
  netProfit,
}: {
  income: PlRow[];
  expense: PlRow[];
  incomeTotal: SectionTotal;
  expenseTotal: SectionTotal;
  netProfit: { amount: string; positive: boolean };
}) {
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
    for (const r of [...income, ...expense]) map.set(r.id, r.parentId);
    return map;
  }, [income, expense]);

  const isHidden = (r: PlRow) => {
    let p = r.parentId;
    while (p) {
      if (collapsed.has(p)) return true;
      p = parentOf.get(p) ?? null;
    }
    return false;
  };

  function renderRow(r: PlRow) {
    if (isHidden(r)) return null;
    const pad = { paddingLeft: `${1.5 + r.depth * 1.25}rem` };
    if (r.isGroup) {
      const isCollapsed = collapsed.has(r.id);
      return (
        <TableRow key={r.id} className="cursor-pointer bg-muted/40 hover:bg-muted/60" onClick={() => toggle(r.id)}>
          <TableCell />
          <TableCell style={pad} className="font-semibold uppercase tracking-wide">
            <span className="mr-1.5 inline-flex size-4 shrink-0 items-center justify-center align-middle text-muted-foreground">
              {isCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
            </span>
            {r.name}
          </TableCell>
          <TableCell className="text-right font-mono font-semibold tabular-nums">{r.debit}</TableCell>
          <TableCell className="text-right font-mono font-semibold tabular-nums">{r.credit}</TableCell>
          <TableCell className="text-right font-mono font-semibold tabular-nums">{r.amount}</TableCell>
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
        <TableCell className="text-right font-mono tabular-nums">{r.amount}</TableCell>
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
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableCell colSpan={5} className="font-semibold">
              Income
            </TableCell>
          </TableRow>
          {income.map(renderRow)}
          <TableRow className={totalRowClass}>
            <TableCell />
            <TableCell className="font-medium">Total income</TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">{incomeTotal.debit}</TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">{incomeTotal.credit}</TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">{incomeTotal.amount}</TableCell>
          </TableRow>

          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableCell colSpan={5} className="font-semibold">
              Expense
            </TableCell>
          </TableRow>
          {expense.map(renderRow)}
          <TableRow className={totalRowClass}>
            <TableCell />
            <TableCell className="font-medium">Total expense</TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">{expenseTotal.debit}</TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">{expenseTotal.credit}</TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">{expenseTotal.amount}</TableCell>
          </TableRow>

          <TableRow className={totalRowClass}>
            <TableCell colSpan={4} className="font-semibold">
              Net profit / (loss)
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-mono font-semibold tabular-nums",
                netProfit.positive ? "text-success" : "text-destructive",
              )}
            >
              {netProfit.amount}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
