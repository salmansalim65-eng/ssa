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
import { deleteAsset } from "@/features/assets/actions";

export function DeleteAssetButton({ assetId, assetName }: { assetId: string; assetName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await deleteAsset(assetId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Asset deleted");
      setOpen(false);
      router.push("/assets");
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
          <DialogTitle>Delete asset</DialogTitle>
          <DialogDescription>
            Delete <span className="font-medium text-foreground">{assetName}</span>? This can only be done when the
            asset has no linked leases, sales, purchases or posted accounting entries.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : "Delete asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
