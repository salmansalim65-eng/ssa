"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { updateUaeScheduleDueDate } from "@/features/rental/uae-leases/actions";

// Change one schedule row's due date (and the invoice it generated). Lets an
// admin pull a later month's rent forward — e.g. set September's due date to
// August so August shows both months' amount due.
export function EditScheduleDueDateButton({
  scheduleId,
  currentDueDate,
}: {
  scheduleId: string;
  currentDueDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState(currentDueDate.slice(0, 10));
  const [isPending, startTransition] = useTransition();

  function onSave() {
    startTransition(async () => {
      const result = await updateUaeScheduleDueDate(scheduleId, dueDate);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Due date updated");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarIcon className="size-4" /> Due date
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change due date</DialogTitle>
          <DialogDescription>
            Move this month&apos;s rent to a different due date. The amount and its accounting entry stay the same —
            only when it becomes due changes (so it can be shown due in an earlier month).
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Due date</label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={onSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
