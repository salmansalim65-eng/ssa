import { Badge } from "@/components/ui/badge";
import type { JournalEntryStatus } from "@/types/database.types";

const statusMeta: Record<JournalEntryStatus, { label: string; variant: "secondary" | "outline" | "success" | "destructive" | "warning" }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending: { label: "Pending approval", variant: "warning" },
  approved: { label: "Approved", variant: "outline" },
  posted: { label: "Posted", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  sent_back: { label: "Sent back", variant: "destructive" },
};

export function VoucherStatusBadge({ status }: { status: JournalEntryStatus }) {
  const meta = statusMeta[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
