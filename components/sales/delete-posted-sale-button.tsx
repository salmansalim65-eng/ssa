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
import { deletePostedAssetSale } from "@/features/assets/sale/actions";

// Admin-only "Delete" for a POSTED asset sale. Removes the sale and its journal
// entry and returns the asset to active. Render only when posted and admin.
export function DeletePostedSaleButton({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await deletePostedAssetSale(saleId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Asset sale deleted");
      setOpen(false);
      router.push("/sales");
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
          <DialogTitle>Delete asset sale</DialogTitle>
          <DialogDescription>
            This permanently deletes the sale voucher and its accounting entry, and returns the sold asset to active.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : "Delete asset sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
