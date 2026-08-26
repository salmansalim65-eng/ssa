"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PencilIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { editPostedRentInvoice } from "@/features/rental/rent-invoices/edit-actions";

// Admin-only "Edit" for a POSTED rent invoice. Changes the rent amount and/or
// due date by rebuilding the invoice + journal entry through the tested posting
// path (see editPostedRentInvoice). Render only when posted and the user is an
// admin. Invoices with recorded payments can't be edited.
export function EditPostedInvoiceButton({
  invoiceId,
  country,
  amount,
  dueDate,
  currencyCode,
}: {
  invoiceId: string;
  country: "uae" | "pk";
  amount: number;
  dueDate: string;
  currencyCode?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amountStr, setAmountStr] = useState(String(amount));
  const [due, setDue] = useState(dueDate);
  const [isPending, startTransition] = useTransition();

  function onSave() {
    const amt = Number(amountStr);
    if (!(amt > 0)) {
      toast.error("Amount must be greater than zero.");
      return;
    }
    startTransition(async () => {
      const result = await editPostedRentInvoice({ invoiceId, country, amount: amt, dueDate: due });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Invoice updated");
      setOpen(false);
      // The rebuild creates a new invoice id — navigate to it.
      if (result.id) router.push(`/rental/${country}/invoices/${result.id}`);
      else router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          // Reset fields to the current invoice values each time it opens.
          setAmountStr(String(amount));
          setDue(dueDate);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PencilIcon className="size-4" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit invoice</DialogTitle>
          <DialogDescription>
            Change the rent amount or due date. This rebuilds the invoice and its accounting entry and keeps the same
            document number. Invoices with recorded payments can&apos;t be edited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-invoice-amount">Amount{currencyCode ? ` (${currencyCode})` : ""}</Label>
            <Input
              id="edit-invoice-amount"
              type="number"
              step="0.01"
              min="0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-invoice-due">Due date</Label>
            <Input id="edit-invoice-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={onSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
