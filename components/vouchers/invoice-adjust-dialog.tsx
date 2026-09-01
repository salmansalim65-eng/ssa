"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";

export interface OutstandingBill {
  id: string;
  // "rental" = a rental invoice (default); "jv" = an open Journal Voucher
  // ledger item on the party account. Same dialog, different save target.
  source?: "rental" | "jv";
  country: "UAE" | "PK";
  accountId: string | null;
  reference: string;
  dueDate: string | null;
  billAmount: number;
}

export interface BillAllocation {
  invoiceId: string;
  source?: "rental" | "jv";
  country: "UAE" | "PK";
  amount: number;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Adjustment dialog: split a receipt/payment line amount across the selected
 * party's outstanding rental bills. Mirrors the classic "Outstanding Bills"
 * adjustment window — pick amounts per bill, or auto-fill oldest-first (FIFO).
 */
export function InvoiceAdjustDialog({
  open,
  onOpenChange,
  lineAmount,
  currencyCode,
  bills,
  value,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lineAmount: number;
  currencyCode?: string;
  bills: OutstandingBill[];
  value: BillAllocation[];
  onSave: (allocations: BillAllocation[]) => void;
}) {
  // The dialog is mounted fresh each time a line opens it, so initialise the
  // per-bill inputs from any existing allocations once, lazily.
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const a of value) m[a.invoiceId] = String(a.amount);
    return m;
  });

  const adjusted = round2(bills.reduce((s, b) => s + (Number(draft[b.id]) || 0), 0));
  const remaining = round2(lineAmount - adjusted);

  function autoFifo() {
    let rem = lineAmount;
    const m: Record<string, string> = {};
    for (const b of bills) {
      if (rem <= 0) break;
      const take = Math.min(rem, b.billAmount);
      if (take > 0) m[b.id] = String(round2(take));
      rem = round2(rem - take);
    }
    setDraft(m);
  }

  function save() {
    const allocations = bills
      .filter((b) => Number(draft[b.id]) > 0)
      .map((b) => ({
        invoiceId: b.id,
        source: b.source ?? "rental",
        country: b.country,
        amount: round2(Number(draft[b.id])),
      }));
    onSave(allocations);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Outstanding Bills — Adjustment</DialogTitle>
        </DialogHeader>

        {bills.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No outstanding bills for the selected account.
          </p>
        ) : (
          <div className="max-h-[52vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                <tr>
                  <th>Reference</th>
                  <th className="w-32">Due Date</th>
                  <th className="w-32 text-right">Bill Amount</th>
                  <th className="w-40 text-right">Amount Adjusted</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-t [&_td]:px-3 [&_td]:py-1.5">
                    <td>{b.reference}</td>
                    <td className="text-muted-foreground">{b.dueDate ? formatDate(b.dueDate) : ""}</td>
                    <td className="text-right font-mono tabular-nums">{fmt(b.billAmount)}</td>
                    <td>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max={b.billAmount}
                        value={draft[b.id] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [b.id]: e.target.value }))}
                        className="h-8 text-right tabular-nums"
                        placeholder="0.00"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>
            Amount to Adjust:{" "}
            <span className="font-mono font-semibold tabular-nums">{fmt(lineAmount)}</span>
            {currencyCode ? ` ${currencyCode}` : ""}
          </span>
          <span>
            Amount Adjusted: <span className="font-mono font-semibold tabular-nums">{fmt(adjusted)}</span>
          </span>
          <span className={remaining < 0 ? "text-destructive" : ""}>
            To be Adjusted: <span className="font-mono font-semibold tabular-nums">{fmt(remaining)}</span>
          </span>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={autoFifo} disabled={!bills.length}>
            Auto (FIFO)
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={remaining < -0.001}>
              OK
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
