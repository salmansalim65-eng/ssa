"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actOnVoucher, submitVoucher } from "@/features/accounting/vouchers/shared-actions";
import type { Phase5VoucherType } from "@/lib/vouchers/meta";
import type { JournalEntryStatus } from "@/types/database.types";

export function VoucherActions({
  status,
  voucherType,
  voucherId,
  journalEntryId,
  amount,
  approvalId,
  canSubmit,
  canApprove,
  canReject,
  canPost,
  onPost,
}: {
  status: JournalEntryStatus;
  voucherType: Phase5VoucherType;
  voucherId: string;
  journalEntryId: string;
  amount: number;
  approvalId: string | null;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canPost: boolean;
  onPost: (id: string, journalEntryId: string) => Promise<{ error?: string; voucherNo?: string } | undefined>;
}) {
  const [isPending, startTransition] = useTransition();
  const [commentDialog, setCommentDialog] = useState<"reject" | "send_back" | null>(null);
  const [comment, setComment] = useState("");

  function run(
    action: () => Promise<{ error?: string; success?: boolean } | undefined>,
    successMessage: string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) toast.error(result.error);
      else toast.success(successMessage);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && canSubmit && (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => run(() => submitVoucher(voucherType, voucherId, journalEntryId, amount), "Submitted for approval")}
        >
          Submit for approval
        </Button>
      )}

      {status === "pending" && approvalId && (
        <>
          {canApprove && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => run(() => actOnVoucher(voucherType, approvalId, journalEntryId, "approve"), "Approved")}
            >
              Approve
            </Button>
          )}
          {canReject && (
            <Button variant="destructive" size="sm" disabled={isPending} onClick={() => setCommentDialog("reject")}>
              Reject
            </Button>
          )}
          {canApprove && (
            <Button variant="outline" size="sm" disabled={isPending} onClick={() => setCommentDialog("send_back")}>
              Send back
            </Button>
          )}
        </>
      )}

      {status === "approved" && canPost && (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await onPost(voucherId, journalEntryId);
              if (result?.error) toast.error(result.error);
              else toast.success(`Posted as ${result?.voucherNo}`);
            })
          }
        >
          Post
        </Button>
      )}

      <Dialog open={commentDialog !== null} onOpenChange={(open) => !open && setCommentDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{commentDialog === "reject" ? "Reject voucher" : "Send back to creator"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="approval-comment">Comment</Label>
            <Input id="approval-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              variant={commentDialog === "reject" ? "destructive" : "default"}
              disabled={isPending}
              onClick={() => {
                if (!approvalId || !commentDialog) return;
                run(
                  async () => {
                    const result = await actOnVoucher(voucherType, approvalId, journalEntryId, commentDialog, comment);
                    if (!("error" in result)) setCommentDialog(null);
                    return result;
                  },
                  commentDialog === "reject" ? "Rejected" : "Sent back",
                );
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
