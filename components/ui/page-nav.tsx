import Link from "next/link";
import { ArrowLeftIcon, HomeIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Consistent Home + Back controls used across detail, create and edit screens.
// Home always routes to the dashboard; Back routes to the given logical list
// (an explicit href, not browser history, so it is predictable). Rendered as a
// small muted row above the page title. Hidden in print output.
export function PageNav({
  backHref,
  backLabel = "Back",
  className,
}: {
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1 text-sm print:hidden", className)}>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HomeIcon className="size-4" /> Home
      </Link>
      {backHref && (
        <>
          <span className="text-muted-foreground/40" aria-hidden>
            /
          </span>
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" /> {backLabel}
          </Link>
        </>
      )}
    </div>
  );
}
