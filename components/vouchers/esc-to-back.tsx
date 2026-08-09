"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Pressing Escape on a detail page returns to the previous page — e.g. a voucher
// opened from the General Ledger returns to that exact ledger view (with its
// account/date filters), not the generic list. Ignores Escape while typing in a
// field or when a dialog is open (dialogs handle their own Escape).
export function EscToBack() {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (document.querySelector("[role='dialog'][data-state='open'], [role='menu'][data-state='open']")) return;
      router.back();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}
