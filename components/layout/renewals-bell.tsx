import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The renewal alert: a calendar carrying the number of lease contracts that have
 * reached or passed their renewal date. It sits beside the approvals bell on
 * every screen, so a contract running out is noticed on the day it happens and
 * not only by whoever opens the dashboard.
 *
 * `target="_top"` because a page opened as a workspace tab renders inside an
 * iframe — without it the whole shell would nest inside itself.
 */
export function RenewalsBell({ count, overdue }: { count: number; overdue: number }) {
  const due = count > 0;
  const label = due
    ? `${count} lease contract${count === 1 ? "" : "s"} due for renewal${overdue > 0 ? ` (${overdue} overdue)` : ""}`
    : "No lease renewals due";
  return (
    <Link
      href="/dashboard"
      target="_top"
      title={label}
      aria-label={label}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
    >
      <CalendarClockIcon className={cn("size-5", due && "text-white")} />
      {due && (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[0.6rem] font-bold leading-4 text-white tabular-nums",
            // Red only once a contract has actually run out; amber while it is
            // merely approaching, so the two states are never confused.
            overdue > 0 ? "bg-destructive" : "bg-amber-600",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
