import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: string;
  subtext?: string;
  icon: LucideIcon;
  tone?: "success" | "destructive" | "warning";
  href?: string;
}) {
  // Same green-header house style as the summary cards: a green title bar over a
  // light body, bordered in green.
  const card = (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-md border-2 border-ledger-dark bg-card shadow-sm",
        href && "transition-shadow hover:shadow-md",
      )}
    >
      <div className="truncate border-b-2 border-ledger-dark bg-ledger-dark px-3 py-1.5 text-center text-[0.7rem] font-bold uppercase tracking-wide text-white">
        {label}
      </div>
      <div className="flex flex-1 items-center justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <p
            className={cn(
              "text-2xl font-semibold tracking-tight tabular-nums text-foreground",
              tone === "success" && "text-success",
              tone === "destructive" && "text-destructive",
              tone === "warning" && "text-warning",
            )}
          >
            {value}
          </p>
          {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
        </div>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            tone === "success" && "bg-success/12 text-success",
            tone === "destructive" && "bg-destructive/10 text-destructive",
            tone === "warning" && "bg-warning/15 text-warning",
            !tone && "bg-ledger/12 text-ledger-dark",
          )}
        >
          <Icon className="size-4.5" />
        </span>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {card}
      </Link>
    );
  }
  return card;
}
