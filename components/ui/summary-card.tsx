import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Compact KPI tile for the top of list/overview screens. Values are computed
// from real data by the caller — this component only presents them.
export function SummaryCard({
  label,
  value,
  icon: Icon,
  accent = "neutral",
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: "neutral" | "primary" | "success" | "warning" | "destructive";
  className?: string;
}) {
  const accentClasses: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/10 text-destructive",
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            accentClasses[accent],
          )}
        >
          <Icon className="size-4.5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  );
}
