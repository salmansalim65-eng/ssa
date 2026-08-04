"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ReceiptIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { generateAllUaeRentInvoices } from "@/features/rental/uae-rent-invoices/actions";
import { generateAllPkRentInvoices } from "@/features/rental/pk-rent-invoices/actions";

export function GenerateAllInvoicesButton({
  leaseId,
  country,
  pendingCount,
}: {
  leaseId: string;
  country: "uae" | "pk";
  pendingCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = country === "uae" ? await generateAllUaeRentInvoices(leaseId) : await generateAllPkRentInvoices(leaseId);
      if (result?.error && !("generated" in result)) {
        toast.error(result.error);
        return;
      }
      const generated = "generated" in result ? result.generated : 0;
      if (result?.error) {
        toast.warning(`Generated ${generated} invoice(s), then stopped: ${result.error}`);
      } else {
        toast.success(`Generated ${generated} invoice(s)`);
      }
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={isPending}>
      <ReceiptIcon className="size-4" />
      {isPending ? "Generating…" : `Generate all invoices (${pendingCount})`}
    </Button>
  );
}
