"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { postExpenseVoucher } from "@/features/accounting/vouchers/expense/actions";

/**
 * Post a stuck expense voucher without leaving the report.
 *
 * A voucher that never reached the ledger is invisible in every figure above
 * it, and the report is where that is noticed — so the fix belongs here rather
 * than three clicks away on the voucher. A failure is said out loud: the reason
 * (a missing post permission, an unbalanced entry) is the whole point of
 * pressing the button.
 */
export function PostExpenseButton({
  voucherId,
  journalEntryId,
}: {
  voucherId: string;
  journalEntryId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await postExpenseVoucher(voucherId, journalEntryId);
            if (result && "error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success(`Posted${result?.voucherNo ? ` as ${result.voucherNo}` : ""}`);
            router.refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
        })
      }
    >
      {isPending ? "Posting…" : "Post"}
    </Button>
  );
}
