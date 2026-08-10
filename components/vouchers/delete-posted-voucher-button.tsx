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
import { deletePostedVoucher } from "@/features/accounting/vouchers/shared-actions";
import type { VoucherType } from "@/types/database.types";

// Admin-only "Delete" for a POSTED accounting voucher. Physically removes the
// voucher and its journal entry rather than leaving a reversed document behind.
// Render only when the voucher is posted and the user is an admin.
export function DeletePostedVoucherButton({
  voucherType,
  voucherId,
  redirectTo,
  label = "voucher",
}: {
  voucherType: VoucherType;
  voucherId: string;
  redirectTo: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await deletePostedVoucher(voucherType, voucherId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Posted voucher deleted");
      setOpen(false);
      router.push(redirectTo);
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
          <DialogTitle>Delete posted {label}</DialogTitle>
          <DialogDescription>
            This permanently deletes the {label} and its accounting entry. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : `Delete ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
