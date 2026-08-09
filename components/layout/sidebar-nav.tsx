"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { navSections } from "./nav-items";

// Which section headings the user has EXPANDED, persisted in localStorage and
// read through useSyncExternalStore so the server snapshot (nothing expanded)
// matches hydration. Sections are collapsed by default; the section holding the
// active page still opens automatically.
const SECTIONS_KEY = "ssa-sidebar-expanded";
const EMPTY_SECTIONS: readonly string[] = [];
const sectionListeners = new Set<() => void>();
let cachedRaw = "";
let cachedValue: readonly string[] = EMPTY_SECTIONS;

function subscribeSections(cb: () => void) {
  sectionListeners.add(cb);
  return () => sectionListeners.delete(cb);
}
function getExpandedSnapshot(): readonly string[] {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem(SECTIONS_KEY) ?? "" : "";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedValue = raw ? (JSON.parse(raw) as string[]) : EMPTY_SECTIONS;
    } catch {
      cachedValue = EMPTY_SECTIONS;
    }
  }
  return cachedValue;
}
function getExpandedServerSnapshot(): readonly string[] {
  return EMPTY_SECTIONS;
}
function toggleSectionPref(label: string) {
  const current = new Set(getExpandedSnapshot());
  if (current.has(label)) current.delete(label);
  else current.add(label);
  if (typeof window !== "undefined") window.localStorage.setItem(SECTIONS_KEY, JSON.stringify([...current]));
  for (const l of sectionListeners) l();
}

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const expandedList = useSyncExternalStore(subscribeSections, getExpandedSnapshot, getExpandedServerSnapshot);
  const expandedSections = new Set(expandedList);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderItems(items: typeof navSections[number]["items"]) {
    return (
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          const link = (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center rounded-md text-sm transition-colors",
                collapsed ? "size-9 justify-center" : "gap-2.5 px-3 py-2",
                active
                  ? "bg-primary/10 font-semibold text-primary"
                  : "font-medium text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
              )}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
                  aria-hidden
                />
              )}
              <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground/80")} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );

          if (!collapsed) return link;

          return (
            <Tooltip key={item.href} delayDuration={0}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <nav className={cn("flex flex-col gap-2 py-4", collapsed ? "px-2" : "px-3")}>
      {navSections.map((section, sectionIndex) => {
        // Unlabelled group (e.g. Dashboard) and the icon-rail mode are never
        // collapsible — they always render their items.
        if (!section.label || collapsed) {
          return (
            <div key={section.label || "root"} className={collapsed ? "flex flex-col gap-0.5" : "mb-2"}>
              {section.label && collapsed && sectionIndex > 0 && (
                <div className="mx-2 mb-2 border-t border-sidebar-border" />
              )}
              {renderItems(section.items)}
            </div>
          );
        }

        const sectionActive = section.items.some((i) => isActive(i.href));
        const open = sectionActive || expandedSections.has(section.label);

        return (
          <div key={section.label} className="mb-1">
            <button
              type="button"
              onClick={() => toggleSectionPref(section.label!)}
              aria-expanded={open}
              className={cn(
                "group flex w-full items-center gap-1.5 rounded-md border border-sidebar-border/60 px-3 py-1.5",
                "text-[0.68rem] font-semibold uppercase tracking-[0.12em] transition-colors",
                sectionActive
                  ? "bg-accent text-group"
                  : "bg-muted/60 text-muted-foreground/90 hover:bg-muted hover:text-foreground",
              )}
            >
              <ChevronDownIcon
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-150",
                  open ? "rotate-0" : "-rotate-90",
                )}
                aria-hidden
              />
              <span className="truncate">{section.label}</span>
            </button>
            {open && <div className="mt-0.5">{renderItems(section.items)}</div>}
          </div>
        );
      })}
    </nav>
  );
}
