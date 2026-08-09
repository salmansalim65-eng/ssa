import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PageNav } from "@/components/ui/page-nav";

// Consistent page masthead used at the top of every major screen: an optional
// Home/Back nav row, a small module eyebrow, the page title, an optional
// one-line description, and a slot for primary/secondary actions kept
// flush-right on wider screens. Passing `backHref` renders the Home + Back
// controls (used on detail/create/edit screens).
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backHref,
  backLabel,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  // A light, elevated masthead — a white card band distinct from the page, with
  // a blue eyebrow accent and dark title. (The dark navy treatment now lives on
  // the table column headers instead.) Print flattens it to plain text.
  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border bg-card px-5 py-4 shadow-xs",
        "print:rounded-none print:border-0 print:bg-transparent print:px-0 print:py-0 print:shadow-none",
        className,
      )}
    >
      {backHref && <PageNav backHref={backHref} backLabel={backLabel} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
    </div>
  );
}
