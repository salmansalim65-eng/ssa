"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { StarIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AttachmentUploader } from "@/components/attachments/attachment-uploader";
import { attachAssetImage, removeAssetImage, setAssetImagePrimary } from "@/features/assets/actions";

export interface AssetImageItem {
  id: string;
  attachmentId: string;
  url: string | null;
  fileName: string;
  isPrimary: boolean;
}

export function AssetImagesManager({
  assetId,
  images,
  canEdit,
}: {
  assetId: string;
  images: AssetImageItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {images.map((image) => (
          <div key={image.id} className="relative overflow-hidden rounded-md border">
            {image.url ? (
              <Image
                src={image.url}
                alt={image.fileName}
                width={200}
                height={150}
                className="h-32 w-full object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-32 w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                Unavailable
              </div>
            )}
            {image.isPrimary && (
              <Badge className="absolute top-1 left-1">Primary</Badge>
            )}
            {canEdit && (
              <div className="absolute top-1 right-1 flex gap-1">
                {!image.isPrimary && (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="size-6"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setAssetImagePrimary(image.id, assetId);
                        if (result?.error) toast.error(result.error);
                        else router.refresh();
                      })
                    }
                  >
                    <StarIcon className="size-3" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="size-6"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeAssetImage(image.id, assetId, image.attachmentId);
                      if (result?.error) toast.error(result.error);
                      else router.refresh();
                    })
                  }
                >
                  <Trash2Icon className="size-3" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {images.length === 0 && (
          <p className="col-span-full text-sm text-muted-foreground">No images yet.</p>
        )}
      </div>

      {canEdit && (
        <AttachmentUploader
          bucket="asset-images"
          entityType="asset"
          entityId={assetId}
          label="Upload image"
          accept="image/*"
          onUploaded={async (attachment) => {
            const result = await attachAssetImage(assetId, attachment.id, images.length === 0);
            if (result?.error) toast.error(result.error);
            else router.refresh();
          }}
        />
      )}
    </div>
  );
}
