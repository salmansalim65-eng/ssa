"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function PdcStatusActions({
  onSetStatus,
}: {
  onSetStatus: (status: "cleared" | "cancelled") => Promise<{ error?: string } | undefined>;
}) {
  const [isPending, startTransition] = useTransition();

  function run(status: "cleared" | "cancelled") {
    startTransition(async () => {
      const result = await onSetStatus(status);
      if (result?.error) toast.error(result.error);
      else toast.success(`Marked ${status}`);
    });
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("cleared")}>
        Mark cleared
      </Button>
      <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("cancelled")}>
        Cancel
      </Button>
    </div>
  );
}
