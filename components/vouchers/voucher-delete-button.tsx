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

export function VoucherDeleteButton({
  id,
  onDelete,
  listHref,
  label = "voucher",
  description,
}: {
  id: string;
  onDelete: (id: string) => Promise<{ error?: string; success?: boolean } | undefined>;
  listHref: string;
  label?: string;
  /**
   * What this delete actually takes with it. The default speaks for a draft
   * voucher; a document that can be deleted after posting has more to say, and
   * the dialog is the last place to say it.
   */
  description?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await onDelete(id);
      if (result?.error) {
        // A refusal explains itself — money adjusted against a bill, a period
        // closed — so it is left up long enough to read.
        toast.error(result.error, { duration: 15000 });
        return;
      }
      toast.success("Voucher deleted");
      setOpen(false);
      router.push(listHref);
      router.refresh();
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
          <DialogTitle>Delete this {label}?</DialogTitle>
          <DialogDescription>
            {description ??
              `This permanently removes the draft ${label} and its journal entry. Only unposted drafts can be deleted.`}
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
