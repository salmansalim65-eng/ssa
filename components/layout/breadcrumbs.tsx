"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { ChevronRightIcon } from "lucide-react";

function toLabel(segment: string) {
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
      {segments.map((segment, index) => {
        const href = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        return (
          <Fragment key={href}>
            {index > 0 && <ChevronRightIcon className="size-3.5" />}
            {isLast ? (
              <span className="font-medium text-foreground">{toLabel(segment)}</span>
            ) : (
              <Link href={href} className="hover:text-foreground">
                {toLabel(segment)}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
