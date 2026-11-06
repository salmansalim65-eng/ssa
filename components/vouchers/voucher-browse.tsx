"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FolderOpenIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { formatDate, formatMoney, formatVoucherNo } from "@/lib/format";
import type { VoucherListRow } from "@/lib/vouchers/queries";

/**
 * Browse: the previous vouchers, from inside the voucher itself.
 *
 * The menu used to open the register and leave you a click away from the thing
 * you came to do. Now it opens a blank voucher, which makes finding an old one
 * the thing that needs a way in — this is it. Pick one and it opens in place;
 * there is no trip back to a list and no losing your place.
 *
 * It holds the most recent vouchers, not all of them, and says so: a dialog
 * that has to load two thousand rows to be opened is a dialog people stop
 * opening. The register is one link away for everything older, and the search
 * box filters what is here by number, date, party or amount.
 */
export function VoucherBrowse({
  voucherType,
  rows,
  total,
}: {
  voucherType: string;
  rows: VoucherListRow[];
  /** How many there are in all, so the dialog can say what it is not showing. */
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.voucherNo ?? "", r.date, r.party, String(r.amount)].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FolderOpenIcon /> Browse
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Open a previous voucher</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Number, date, party or amount"
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="-mx-1 max-h-[55vh] overflow-y-auto px-1">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? "No vouchers yet." : "Nothing matches that."}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {filtered.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/accounting/vouchers/${voucherType}/${r.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <span className="w-28 shrink-0 font-mono text-xs tabular-nums">
                      {r.voucherNo ? formatVoucherNo(r.voucherNo) : <span className="text-muted-foreground">—</span>}
                    </span>
                    <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDate(r.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.party}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {r.currencySymbol ? `${r.currencySymbol} ` : ""}
                      {formatMoney(r.amount)}
                    </span>
                    <VoucherStatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {total > rows.length
            ? `Showing the ${rows.length} most recent of ${total}. `
            : `${rows.length} voucher${rows.length === 1 ? "" : "s"}. `}
          <Link
            href={`/accounting/vouchers/${voucherType}`}
            onClick={() => setOpen(false)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Open the full register
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}
