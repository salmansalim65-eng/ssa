"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FileIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AttachmentUploader } from "@/components/attachments/attachment-uploader";
import { deleteAttachment } from "@/features/attachments/actions";

export interface AttachmentItem {
  id: string;
  fileName: string;
  url: string | null;
}

export function AttachmentList({
  bucket,
  entityType,
  entityId,
  items,
  canEdit,
}: {
  bucket: string;
  entityType: string;
  entityId: string;
  items: AttachmentItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <FileIcon className="size-4 text-muted-foreground" />
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">
                {item.fileName}
              </a>
            ) : (
              <span>{item.fileName}</span>
            )}
            {canEdit && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteAttachment(item.id);
                    if (result?.error) toast.error(result.error);
                    else router.refresh();
                  })
                }
              >
                <Trash2Icon className="size-3" />
              </Button>
            )}
          </li>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No files uploaded yet.</p>}
      </ul>

      {canEdit && (
        <AttachmentUploader
          bucket={bucket}
          entityType={entityType}
          entityId={entityId}
          label="Upload file"
          onUploaded={() => router.refresh()}
        />
      )}
    </div>
  );
}
