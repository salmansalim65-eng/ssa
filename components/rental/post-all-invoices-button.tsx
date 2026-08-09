"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheckIcon } from "lucide-react";
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
import { postAllUaeRentInvoices } from "@/features/rental/uae-rent-invoices/actions";
import { postAllPkRentInvoices } from "@/features/rental/pk-rent-invoices/actions";

export function PostAllInvoicesButton({
  leaseId,
  country,
}: {
  leaseId: string;
  country: "uae" | "pk";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = country === "uae" ? await postAllUaeRentInvoices(leaseId) : await postAllPkRentInvoices(leaseId);
      toast.success(`${result.posted} invoice(s) posted`);
      if (result.failed.length > 0) {
        const preview = result.failed
          .slice(0, 3)
          .map((f) => `${f.label} — ${f.reason}`)
          .join("; ");
        toast.warning(`${result.failed.length} invoice(s) could not be posted: ${preview}`);
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <CheckCheckIcon className="size-4" /> Post All Invoices
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post all invoices</DialogTitle>
          <DialogDescription>
            Are you sure you want to post all eligible (unposted) invoices for this lease?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "Posting…" : "Post all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
