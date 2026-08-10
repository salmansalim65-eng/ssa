import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
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
  const card = (
    <Card
      className={cn(
        // Soft light tint so the stat cards read as gentle light panels rather
        // than plain white.
        "h-full gap-0 border-primary/10 bg-primary/[0.04] py-0",
        href && "transition-colors hover:border-ring/50 hover:bg-primary/[0.07]",
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
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
            !tone && "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4.5" />
        </span>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        {card}
      </Link>
    );
  }
  return card;
}
