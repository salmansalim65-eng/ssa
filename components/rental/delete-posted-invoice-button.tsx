"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { deletePostedRentInvoice } from "@/features/rental/rent-invoices/delete-actions";

// Admin-only "Delete" for a POSTED rent invoice. Actually removes the invoice
// and its journal entry, and reopens the schedule period so it can be
// re-invoiced. Render only when the invoice is posted and the user is an admin.
export function DeletePostedInvoiceButton({
  invoiceId,
  country,
  redirectHref,
}: {
  invoiceId: string;
  country: "uae" | "pk";
  redirectHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await deletePostedRentInvoice(invoiceId, country);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Invoice deleted");
      setOpen(false);
      router.push(redirectHref ?? `/rental/${country}/invoices`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2Icon className="size-4" /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete invoice</DialogTitle>
          <DialogDescription>
            This permanently deletes the invoice and its accounting entry, and reopens the period so it can be
            re-invoiced. Invoices with recorded payments can&apos;t be deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : "Delete invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
