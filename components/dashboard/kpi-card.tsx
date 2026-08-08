import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        "h-full",
        href && "transition-colors hover:border-ring hover:bg-accent/40",
      )}
    >
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight tabular-nums",
            tone === "success" && "text-success",
            tone === "destructive" && "text-destructive",
            tone === "warning" && "text-warning",
          )}
        >
          {value}
        </p>
        {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
        {card}
      </Link>
    );
  }
  return card;
}
