"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { generateUaeRentInvoice } from "@/features/rental/uae-rent-invoices/actions";

export function GenerateInvoiceButton({ scheduleId }: { scheduleId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await generateUaeRentInvoice(scheduleId);
          if (result?.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Invoice generated");
          router.push(`/rental/uae/invoices/${result.id}`);
        })
      }
    >
      {isPending ? "Generating…" : "Generate invoice"}
    </Button>
  );
}
