"use client";

import { useEffect, useState, useTransition } from "react";
import { FileTextIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AttachmentUploader } from "@/components/attachments/attachment-uploader";
import { deleteAttachment } from "@/features/attachments/actions";
import {
  getAccountAttachment,
  setAccountAttachment,
  type AccountAttachmentSlot,
} from "@/features/accounting/chart-of-accounts/actions";

type Current = { id: string; fileName: string; url: string | null } | null;

/**
 * One document slot on an account (ID / police verification / rent agreement).
 * Loads the current file on mount, then shows either a view/remove row or an
 * uploader. Uploads go to the shared `attachments` bucket under the polymorphic
 * `chart_of_account` entity, and the account column is pointed at the new file.
 */
export function AccountAttachmentField({
  accountId,
  slot,
  label,
}: {
  accountId: string;
  slot: AccountAttachmentSlot;
  label: string;
}) {
  const [current, setCurrent] = useState<Current>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    getAccountAttachment(accountId, slot).then((r) => {
      if (active) {
        setCurrent(r);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [accountId, slot]);

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : current ? (
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          {current.url ? (
            <a href={current.url} target="_blank" rel="noreferrer" className="truncate text-sm hover:underline">
              {current.fileName}
            </a>
          ) : (
            <span className="truncate text-sm">{current.fileName}</span>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="ml-auto"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const attId = current.id;
                const res = await setAccountAttachment(accountId, slot, null);
                if (res?.error) {
                  toast.error(res.error);
                  return;
                }
                await deleteAttachment(attId);
                setCurrent(null);
              })
            }
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ) : (
        <AttachmentUploader
          bucket="attachments"
          entityType="chart_of_account"
          entityId={accountId}
          label={`Upload ${label.toLowerCase()}`}
          accept="image/*,application/pdf"
          onUploaded={async (attachment) => {
            const res = await setAccountAttachment(accountId, slot, attachment.id);
            if (res?.error) {
              toast.error(res.error);
              await deleteAttachment(attachment.id);
              return;
            }
            setCurrent(await getAccountAttachment(accountId, slot));
          }}
        />
      )}
    </div>
  );
}
