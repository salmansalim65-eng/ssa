import { type LucideIcon, InboxIcon } from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Friendly placeholder shown in place of an empty table/list, with an optional
// call to action (e.g. "Add account" or "Clear filters").
export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground shadow-xs">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
