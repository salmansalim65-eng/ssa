"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, HomeIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Home + Back controls for report pages. Home routes to the dashboard; Back uses
// browser history (reports have no single logical parent list). Hidden in print.
export function ReportNav({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <div className={cn("flex items-center gap-1 text-sm print:hidden", className)}>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HomeIcon className="size-4" /> Home
      </Link>
      <span className="text-muted-foreground/40" aria-hidden>
        /
      </span>
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> Back
      </button>
    </div>
  );
}
