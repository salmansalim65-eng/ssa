"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FileTextIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AttachmentUploader } from "@/components/attachments/attachment-uploader";
import { setAssetTitleDeed } from "@/features/assets/actions";
import { deleteAttachment } from "@/features/attachments/actions";

export function TitleDeedManager({
  assetId,
  fileName,
  url,
  canEdit,
}: {
  assetId: string;
  fileName: string | null;
  url: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (fileName) {
    return (
      <div className="flex items-center gap-2">
        <FileTextIcon className="size-4 text-muted-foreground" />
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-sm hover:underline">
            {fileName}
          </a>
        ) : (
          <span className="text-sm">{fileName}</span>
        )}
        {canEdit && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await setAssetTitleDeed(assetId, null);
                if (result?.error) {
                  toast.error(result.error);
                  return;
                }
                router.refresh();
              })
            }
          >
            <Trash2Icon className="size-4" />
          </Button>
        )}
      </div>
    );
  }

  if (!canEdit) return <p className="text-sm text-muted-foreground">No title deed uploaded.</p>;

  return (
    <AttachmentUploader
      bucket="title-deeds"
      entityType="asset"
      entityId={assetId}
      label="Upload title deed"
      onUploaded={async (attachment) => {
        const result = await setAssetTitleDeed(assetId, attachment.id);
        if (result?.error) {
          toast.error(result.error);
          await deleteAttachment(attachment.id);
          return;
        }
        router.refresh();
      }}
    />
  );
}
