"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { postRentStatement } from "@/features/rental/rent-statements/actions";

/**
 * Posting a statement: the entry reaches the ledger and each short-term line
 * raises an invoice for every month it covers. Only offered while the statement
 * is still a draft.
 */
export function PostStatementButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await postRentStatement(id);
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          // A bill that could not be raised leaves the agent owing money with
          // nothing to allocate a receipt against, so it is said out loud
          // rather than buried in a success message.
          if (result.warning) toast.warning(result.warning, { duration: 15000 });
          else toast.success(`Posted as ${result.voucherNo}`);
          router.refresh();
        })
      }
    >
      <CheckCircle2Icon /> {isPending ? "Posting…" : "Post"}
    </Button>
  );
}
