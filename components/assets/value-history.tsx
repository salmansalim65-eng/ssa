"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteValueHistory } from "@/features/assets/actions";
import { formatDate, formatMoney } from "@/lib/format";

export interface ValueHistoryRow {
  id: string;
  effectiveDate: string;
  previousValue: number | null;
  newValue: number;
  changedBy: string | null;
  remarks: string | null;
}

export function ValueHistory({
  assetId,
  rows,
  canDelete,
  currencyLabel,
}: {
  assetId: string;
  rows: ValueHistoryRow[];
  canDelete: boolean;
  currencyLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const money = (n: number | null) =>
    n == null ? "—" : `${currencyLabel ? `${currencyLabel} ` : ""}${formatMoney(n)}`;

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete;
    startTransition(async () => {
      const result = await deleteValueHistory(id, assetId);
      setPendingDelete(null);
      if (result?.error) toast.error(result.error);
      else {
        toast.success("Value history record deleted");
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Effective date</TableHead>
              <TableHead className="text-right">Previous value</TableHead>
              <TableHead className="text-right">New value</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Change %</TableHead>
              <TableHead>Changed by</TableHead>
              <TableHead>Remarks</TableHead>
              {canDelete && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const hasPrev = r.previousValue != null;
              const change = hasPrev ? r.newValue - (r.previousValue as number) : null;
              const changePct =
                hasPrev && (r.previousValue as number) !== 0
                  ? (change! / (r.previousValue as number)) * 100
                  : null;
              return (
                <TableRow key={r.id}>
                  <TableCell>{formatDate(r.effectiveDate)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(r.previousValue)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(r.newValue)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {change == null ? "—" : `${change > 0 ? "+" : ""}${money(change)}`}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {changePct == null
                      ? "—"
                      : `${changePct > 0 ? "+" : ""}${changePct.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}%`}
                  </TableCell>
                  <TableCell>{r.changedBy ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate">{r.remarks ?? "—"}</TableCell>
                  {canDelete && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={isPending}
                        onClick={() => setPendingDelete(r.id)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={canDelete ? 8 : 7} className="py-8 text-center text-muted-foreground">
                  No value history yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete value history record?</DialogTitle>
            <DialogDescription>
              This permanently removes the record. The asset&apos;s current value will be recalculated from the
              latest remaining record. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
