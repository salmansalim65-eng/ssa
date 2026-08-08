"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SidebarNav } from "./sidebar-nav";

const STORAGE_KEY = "ssa-sidebar-collapsed";

// The collapsed flag is backed by localStorage and read through
// useSyncExternalStore: the server snapshot is always expanded, so hydration
// markup matches, and the stored preference applies on the first client tick.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot() {
  return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
}
function getServerSnapshot() {
  return false;
}
function setCollapsedPref(next: boolean) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  for (const l of listeners) l();
}

export function Sidebar() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    setCollapsedPref(!collapsed);
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          // Pinned full-height column so the nav scrolls on its own and stays
          // in view no matter how tall the page content is.
          "sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex print:hidden",
          collapsed ? "w-16" : "w-64",
        )}
      >
        {/* Navy brand cap — continuous with the header band across the top. */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-header-border bg-header text-header-foreground",
            collapsed ? "justify-center px-2" : "gap-2.5 px-3",
          )}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={toggle}
              aria-label="Expand sidebar"
              className="flex size-9 items-center justify-center rounded-md text-header-muted transition-colors hover:bg-header-accent hover:text-header-foreground"
            >
              <PanelLeftOpenIcon className="size-5" />
            </button>
          ) : (
            <>
              <Image src="/logo.svg" alt="SSA logo" width={32} height={32} priority className="size-8 shrink-0" />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-semibold text-header-foreground">Rental &amp; Accounting</p>
                <p className="truncate text-[0.7rem] uppercase tracking-wider text-header-muted">Enterprise ERP</p>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label="Collapse sidebar"
                className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-md text-header-muted transition-colors hover:bg-header-accent hover:text-header-foreground"
              >
                <PanelLeftCloseIcon className="size-4.5" />
              </button>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <SidebarNav collapsed={collapsed} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
