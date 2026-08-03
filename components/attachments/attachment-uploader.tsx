"use client";

import { useRef, useTransition } from "react";
import { UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { uploadAttachment } from "@/features/attachments/actions";
import type { Database } from "@/types/database.types";

type Attachment = Database["core"]["Tables"]["attachments"]["Row"];

export function AttachmentUploader({
  bucket,
  entityType,
  entityId,
  label = "Upload file",
  accept,
  onUploaded,
}: {
  bucket: string;
  entityType: string;
  entityId: string;
  label?: string;
  accept?: string;
  onUploaded: (attachment: Attachment) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadAttachment(bucket, entityType, entityId, formData);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("File uploaded");
        await onUploaded(result.attachment);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileChange} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon /> {isPending ? "Uploading…" : label}
      </Button>
    </div>
  );
}
