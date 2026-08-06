"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RateHistoryRow {
  id: string;
  currencyCode: string;
  rateDate: string;
  rateToBase: number;
  source: string;
}

type DeleteResult = { error?: string; success?: boolean } | undefined;

function RateDeleteButton({
  row,
  onDelete,
}: {
  row: RateHistoryRow;
  onDelete: (id: string) => Promise<DeleteResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await onDelete(row.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Exchange rate deleted");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Delete rate">
          <Trash2Icon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this exchange rate?</DialogTitle>
          <DialogDescription>
            This removes the {row.currencyCode} rate for {row.rateDate}. Vouchers already posted keep the
            rate they were entered with; only future lookups are affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExchangeRateHistory({
  rows,
  canEdit = false,
  onDelete,
}: {
  rows: RateHistoryRow[];
  canEdit?: boolean;
  onDelete?: (id: string) => Promise<DeleteResult>;
}) {
  const [filter, setFilter] = useState("all");
  const showActions = canEdit && !!onDelete;

  const currencyCodes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.currencyCode))).sort(),
    [rows],
  );

  const filtered = filter === "all" ? rows : rows.filter((r) => r.currencyCode === filter);
  const colCount = showActions ? 5 : 4;

  return (
    <div className="space-y-3">
      <Select value={filter} onValueChange={setFilter}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All currencies</SelectItem>
          {currencyCodes.map((code) => (
            <SelectItem key={code} value={code}>
              {code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead>Rate to base</TableHead>
            <TableHead>Source</TableHead>
            {showActions && <TableHead className="w-10 text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.rateDate}</TableCell>
              <TableCell className="font-mono">{row.currencyCode}</TableCell>
              <TableCell>{row.rateToBase}</TableCell>
              <TableCell className="capitalize text-muted-foreground">{row.source}</TableCell>
              {showActions && (
                <TableCell className="text-right">
                  <RateDeleteButton row={row} onDelete={onDelete!} />
                </TableCell>
              )}
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} className="text-center text-muted-foreground">
                No exchange rates recorded yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
