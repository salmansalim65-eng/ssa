import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The dashboard summary card: a green title bar with white text over a light
 * body, bordered in the same green — the house style from the finance sheet.
 * When `href` is set the whole card is a link and `active` draws a ring so the
 * selected card is obvious while its detail report shows below.
 */
export function SummaryCard({
  title,
  href,
  active,
  children,
}: {
  title: string;
  href?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const inner = (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-md border-2 border-ledger-dark bg-card shadow-sm",
        href && "transition-shadow hover:shadow-md",
        active && "ring-2 ring-ledger-dark ring-offset-2 ring-offset-background",
      )}
    >
      <div className="truncate border-b-2 border-ledger-dark bg-ledger-dark px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white">
        {title}
      </div>
      <div className="flex flex-1 flex-col justify-between gap-3 p-3">{children}</div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

/** A value with a small label beneath it — the column unit used inside the cards. */
export function StatCol({
  value,
  label,
  align = "left",
}: {
  value: string;
  label: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <div className={cn("min-w-0", align === "center" && "text-center", align === "right" && "text-right")}>
      <div className="truncate text-base font-semibold tabular-nums text-foreground">{value}</div>
      <div className="truncate text-[0.68rem] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
