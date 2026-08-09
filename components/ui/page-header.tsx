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
  // A dark navy masthead (logo blue) with a green eyebrow accent and white
  // title — the single distinct header used on every screen. The `dark` class
  // scopes dark-theme tokens to this band so action buttons (outline/ghost)
  // stay legible on navy without per-page styling. Print flattens it to plain
  // dark-on-white text.
  return (
    <div
      className={cn(
        "dark space-y-3 rounded-xl border border-header-border bg-header px-5 py-4 shadow-sm",
        "print:space-y-1 print:rounded-none print:border-0 print:bg-transparent print:px-0 print:py-0 print:shadow-none",
        className,
      )}
    >
      {backHref && <PageNav backHref={backHref} backLabel={backLabel} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wide text-ledger print:text-neutral-600">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground print:text-neutral-900">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm text-muted-foreground print:text-neutral-600">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
    </div>
  );
}
