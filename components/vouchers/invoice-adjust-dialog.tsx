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
  /**
   * Unique per ROW. A combined voucher is offered one bill per property per
   * instalment, so several rows share one `id` (the invoice) — the key is what
   * keeps their amounts apart. Defaults to `id` for a bill that is not split.
   */
  key?: string;
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
  // Keyed by the bill ROW, not the invoice: one invoice can appear as several
  // instalments and each carries its own amount.
  const keyOf = (b: OutstandingBill) => b.key ?? b.id;
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    // An existing allocation is per invoice; put it back on that invoice's first
    // row, which is where FIFO would have placed it.
    for (const a of value) {
      const first = bills.find((b) => b.id === a.invoiceId);
      if (first) m[keyOf(first)] = String(a.amount);
    }
    return m;
  });

  const adjusted = round2(bills.reduce((s, b) => s + (Number(draft[keyOf(b)]) || 0), 0));
  const remaining = round2(lineAmount - adjusted);

  function autoFifo() {
    let rem = lineAmount;
    const m: Record<string, string> = {};
    for (const b of bills) {
      if (rem <= 0) break;
      const take = Math.min(rem, b.billAmount);
      if (take > 0) m[keyOf(b)] = String(round2(take));
      rem = round2(rem - take);
    }
    setDraft(m);
  }

  function save() {
    // Rows are per instalment but an allocation is per invoice, so instalments
    // of the same invoice are added together into one allocation.
    const byInvoice = new Map<string, BillAllocation>();
    for (const b of bills) {
      const amount = Number(draft[keyOf(b)]);
      if (!(amount > 0)) continue;
      const existing = byInvoice.get(b.id);
      if (existing) existing.amount = round2(existing.amount + amount);
      else
        byInvoice.set(b.id, {
          invoiceId: b.id,
          source: b.source ?? "rental",
          country: b.country,
          amount: round2(amount),
        });
    }
    onSave([...byInvoice.values()]);
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
                  <tr key={keyOf(b)} className="border-t [&_td]:px-3 [&_td]:py-1.5">
                    <td>{b.reference}</td>
                    <td className="text-muted-foreground">{b.dueDate ? formatDate(b.dueDate) : ""}</td>
                    <td className="text-right font-mono tabular-nums">{fmt(b.billAmount)}</td>
                    <td>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max={b.billAmount}
                        value={draft[keyOf(b)] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [keyOf(b)]: e.target.value }))}
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
