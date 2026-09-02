"use client";

import { type MouseEvent, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { navSections, filterNavSections } from "./nav-items";
import { isEmbeddedWindow, openTab, goHome, useWorkspace } from "./workspace-store";

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
// Collapse-all / expand-all: overwrite the expanded set outright (empty to
// collapse every heading, all labels to expand them).
function setAllSectionsPref(labels: string[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(labels));
  for (const l of sectionListeners) l();
}

export function SidebarNav({
  onNavigate,
  collapsed = false,
  allowedModules = null,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  allowedModules?: string[] | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Only the sections/items this user may view.
  const sections = filterNavSections(navSections, allowedModules);
  const collapsibleSectionLabels = sections.filter((s) => s.label).map((s) => s.label!);
  const { tabs, activeId } = useWorkspace();
  const expandedList = useSyncExternalStore(subscribeSections, getExpandedSnapshot, getExpandedServerSnapshot);
  const expandedSections = new Set(expandedList);
  const allExpanded = collapsibleSectionLabels.every((l) => expandedSections.has(l));

  // The active nav item follows the focused workspace tab (a report/voucher open
  // in-app); with no tab focused, it falls back to the browser route.
  const activeHref = activeId ? tabs.find((t) => t.id === activeId)?.href ?? null : null;

  function isActive(href: string) {
    if (activeHref) return activeHref === href || activeHref.startsWith(href + "/");
    // No tab focused → Dashboard (home) is active, else the current route.
    if (tabs.length > 0) return href === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Left-click opens the target in an in-app workspace tab instead of navigating
  // the whole window; modified clicks (ctrl/cmd/middle) still open a browser tab.
  function handleNavClick(e: MouseEvent<HTMLAnchorElement>, href: string, label: string) {
    onNavigate?.();
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (href === "/dashboard") {
      // goHome() only reveals the base surface, which is whatever route the top
      // window happens to sit on — so on any other route the Dashboard link
      // appeared to do nothing. Take the window there as well, breaking out of
      // the iframe when this nav is itself rendered inside a workspace tab.
      goHome();
      const top = isEmbeddedWindow() ? window.top : null;
      if (top) top.location.assign("/dashboard");
      else router.push("/dashboard");
      return;
    }
    openTab(href, label);
  }

  function renderItems(items: typeof navSections[number]["items"]) {
    return (
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          // The Dashboard entry is a standout logo-blue button (filled), distinct
          // from the green active-item styling used by every other nav link.
          const isDashboard = item.href === "/dashboard";

          const link = (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => handleNavClick(e, item.href, item.label)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center rounded-md text-sm transition-colors",
                collapsed ? "size-9 justify-center" : "gap-2.5 px-3 py-2",
                isDashboard
                  ? cn(
                      "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
                      active && "ring-2 ring-primary/40 ring-offset-1 ring-offset-sidebar",
                    )
                  : active
                    ? "bg-ledger/15 font-semibold text-ledger-dark"
                    : "font-medium text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
              )}
            >
              {active && !isDashboard && (
                <span
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-ledger"
                  aria-hidden
                />
              )}
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  isDashboard
                    ? "text-primary-foreground"
                    : active
                      ? "text-ledger-dark"
                      : "text-muted-foreground/80",
                )}
              />
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
      {!collapsed && (
        <button
          type="button"
          onClick={() => setAllSectionsPref(allExpanded ? [] : [...collapsibleSectionLabels])}
          className="mb-1 flex items-center justify-center gap-1.5 self-end rounded-md px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          {allExpanded ? (
            <>
              <ChevronsDownUpIcon className="size-3.5" /> Collapse all
            </>
          ) : (
            <>
              <ChevronsUpDownIcon className="size-3.5" /> Expand all
            </>
          )}
        </button>
      )}
      {sections.map((section, sectionIndex) => {
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
                "group flex w-full items-center gap-1.5 rounded-md border border-ledger-dark px-3 py-1.5",
                "text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-white transition-colors",
                // Deep logo-green heading band with light text; the active section
                // is the fullest green, others a touch lighter and darken on hover.
                sectionActive ? "bg-ledger-dark" : "bg-ledger-dark/90 hover:bg-ledger-dark",
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
