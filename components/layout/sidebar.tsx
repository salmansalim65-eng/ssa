"use client";

import { useSyncExternalStore } from "react";
import { Building2Icon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";

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
          "hidden shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex print:hidden",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b",
            collapsed ? "justify-center px-2" : "gap-2.5 px-4",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2Icon className="size-4.5" />
          </span>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">Rental &amp; Accounting</p>
              <p className="truncate text-xs text-muted-foreground">Enterprise ERP</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <SidebarNav collapsed={collapsed} />
        </div>

        <div className={cn("border-t p-2", collapsed && "flex justify-center")}>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
              collapsed ? "size-9 justify-center" : "w-full gap-2.5 px-3 py-2",
            )}
          >
            {collapsed ? (
              <PanelLeftOpenIcon className="size-4 shrink-0" />
            ) : (
              <>
                <PanelLeftCloseIcon className="size-4 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
