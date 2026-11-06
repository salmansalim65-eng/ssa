import Link from "next/link";
import { MegaphoneIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The header's alert bell: things that HAPPENED, as against things waiting to
 * be decided.
 *
 * Deliberately a different icon from the approvals bell beside it. Two
 * identical bells with different numbers would be read as one thing counted
 * twice; these answer different questions — "what must I do" and "what
 * happened" — and only one of them is work.
 *
 * `target="_top"` because a page opened as a workspace tab renders inside an
 * iframe — without it the whole shell would nest inside itself.
 */
export function AlertsBell({ count }: { count: number }) {
  const unread = count > 0;
  return (
    <Link
      href="/notifications"
      target="_top"
      title={unread ? `${count} new alert${count === 1 ? "" : "s"}` : "No new alerts"}
      aria-label={unread ? `${count} new alerts` : "No new alerts"}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
    >
      <MegaphoneIcon className={cn("size-5", unread && "text-white")} />
      {unread && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.6rem] font-bold leading-4 text-white tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
