"use client";

import { useTransition } from "react";
import { CheckCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markAllAlertsRead } from "@/features/notifications/actions";

export function MarkAllRead() {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllAlertsRead();
          if (result?.error) toast.error(result.error);
        })
      }
    >
      <CheckCheckIcon /> {isPending ? "Marking…" : "Mark all read"}
    </Button>
  );
}
