"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setPkLeaseStatus } from "@/features/rental/pk-leases/actions";

const statuses = [
  { value: "active", label: "Mark active" },
  { value: "expired", label: "Mark expired" },
  { value: "terminated", label: "Mark terminated" },
] as const;

export function PkLeaseStatusMenu({ leaseId, status }: { leaseId: string; status: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          Change status
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {statuses
          .filter((s) => s.value !== status)
          .map((s) => (
            <DropdownMenuItem
              key={s.value}
              onSelect={() =>
                startTransition(async () => {
                  const result = await setPkLeaseStatus(leaseId, s.value);
                  if (result?.error) toast.error(result.error);
                  else {
                    toast.success("Lease status updated");
                    router.refresh();
                  }
                })
              }
            >
              {s.label}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
