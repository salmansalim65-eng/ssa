"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type CopyResult = { success?: boolean; id?: string; error?: string } | undefined;

export function CopyVoucherButton({
  id,
  onCopy,
  hrefBase,
  label,
}: {
  id: string;
  onCopy: (id: string) => Promise<CopyResult>;
  hrefBase: string;
  label: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await onCopy(id);
          if (result?.error) {
            toast.error(result.error);
            return;
          }
          toast.success(`${label} copied to a new draft`);
          if (result?.id) router.push(`${hrefBase}/${result.id}`);
        })
      }
    >
      <CopyIcon /> {isPending ? "Copying…" : "Copy"}
    </Button>
  );
}
