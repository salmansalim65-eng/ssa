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
import { reversePostedDocument } from "@/features/accounting/vouchers/reversal-actions";

// Admin-only "Delete" for a POSTED voucher/invoice. It reverses the accounting
// effect (a balanced reversing entry) rather than physically deleting ledger
// history. Render only when the document is posted and the user is an admin.
export function ReversePostedButton({
  journalEntryId,
  revalidate = [],
  redirectTo,
  label = "Delete",
}: {
  journalEntryId: string;
  revalidate?: string[];
  redirectTo?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await reversePostedDocument(journalEntryId, revalidate);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Posted document reversed");
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2Icon className="size-4" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete posted document</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this posted document? This action will reverse its accounting effect.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Reversing…" : "Delete & reverse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
