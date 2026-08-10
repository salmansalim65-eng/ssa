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
import { deleteUaeLease } from "@/features/rental/uae-leases/actions";
import { deletePkLease } from "@/features/rental/pk-leases/actions";

export function LeaseDeleteButton({
  leaseId,
  country,
}: {
  leaseId: string;
  country: "uae" | "pk";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const label = country === "uae" ? "UAE lease" : "Pakistan lease";
  const listHref = country === "uae" ? "/rental/uae/leases" : "/rental/pk/leases";

  function onConfirm() {
    startTransition(async () => {
      const result = country === "uae" ? await deleteUaeLease(leaseId) : await deletePkLease(leaseId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Lease deleted");
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
            The lease is removed from the list, and <strong>every invoice generated from it is deleted too —
            including posted ones</strong>, so their rental income is cleared from the ledger and reports. The
            lease record itself is retained for audit and can be restored by an administrator. A lease whose
            invoices have recorded payments can&apos;t be deleted — remove the payments first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : "Delete lease"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
