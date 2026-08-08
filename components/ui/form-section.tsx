import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// A titled section used to break long forms (vouchers, account setup) into
// logical, scannable groups. Renders as a bordered surface with a subtly
// tinted header band — an optional icon, a strong title and an optional
// one-line description — over a padded body holding the fields.
export function FormSection({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border bg-card shadow-xs", className)}>
      <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
        {Icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </section>
  );
}
