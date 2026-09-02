import Link from "next/link";
import { BellIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The header's approval alert: a bell carrying the number of vouchers waiting
 * for a decision, linking straight to that filtered register. It is the standing
 * signal that something arrived for approval, so it sits on every screen rather
 * than only on the dashboard.
 *
 * `target="_top"` because a page opened as a workspace tab renders inside an
 * iframe — without it the whole shell would nest inside itself.
 */
export function ApprovalsBell({ count }: { count: number }) {
  const waiting = count > 0;
  return (
    <Link
      href="/accounting/voucher-register?status=pending"
      target="_top"
      title={waiting ? `${count} voucher${count === 1 ? "" : "s"} waiting for approval` : "No vouchers waiting for approval"}
      aria-label={waiting ? `${count} vouchers waiting for approval` : "No vouchers waiting for approval"}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
    >
      <BellIcon className={cn("size-5", waiting && "text-white")} />
      {waiting && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.6rem] font-bold leading-4 text-white tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
