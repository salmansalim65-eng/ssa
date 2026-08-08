import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Generic active/inactive style pill with a leading status dot, for non-voucher
// records (accounts, cost centres, users, …). Voucher workflow statuses keep
// their dedicated VoucherStatusBadge.
export function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-medium">
      <span
        className={cn("size-1.5 rounded-full", active ? "bg-success" : "bg-muted-foreground/60")}
        aria-hidden
      />
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}
