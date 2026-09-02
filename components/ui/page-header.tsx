import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PageNav } from "@/components/ui/page-nav";

// Slim page toolbar shown at the top of every major screen. The boxed masthead
// (eyebrow + large title + description) was removed across the ERP — the page
// name now comes from the global breadcrumb in the header, matching the Rent
// Report / Property Report layout. What remains is a compact controls row: the
// optional Home/Back nav on the left and the page's primary/secondary actions on
// the right. `eyebrow`, `title` and `description` are still accepted so callers
// need no change, but they are intentionally not rendered.
export function PageHeader({
  actions,
  backHref,
  backLabel,
  className,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  // The Home link is always worth showing — it used to render only when a
  // caller passed a backHref, which left most top-level screens (the voucher
  // lists, the reports) with no way back to the dashboard. Back still needs a
  // target, so it appears only when one is given.

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 print:hidden",
        className,
      )}
    >
      <div className="min-w-0">
        <PageNav backHref={backHref} backLabel={backLabel} />
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
