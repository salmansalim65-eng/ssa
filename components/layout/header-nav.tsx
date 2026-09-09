"use client";

import { type MouseEvent } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { filterNavSections, navSections } from "./nav-items";
import { openTab, useWorkspace } from "./workspace-store";

/**
 * The sections lifted out of the sidebar into the header band. Order is the
 * order they appear across the bar.
 */
export const HEADER_NAV_SECTIONS = ["Rental", "Vouchers", "Reports"];

/**
 * Rental, Vouchers and Reports as drop-downs in the green header.
 *
 * These are the three the day is spent in, and hunting them down a scrolling
 * sidebar cost a click and a scroll every time. Each item opens in a workspace
 * tab exactly as the sidebar's do, so nothing about how the app behaves changes
 * — only where the menu lives. The sidebar keeps every other section, and the
 * mobile sheet still carries all of them, since there is no room for a menu bar
 * on a phone.
 */
export function HeaderNav({ allowedModules = null }: { allowedModules?: string[] | null }) {
  const { tabs, activeId } = useWorkspace();
  const sections = filterNavSections(navSections, allowedModules).filter(
    (s) => s.label && HEADER_NAV_SECTIONS.includes(s.label),
  );
  // Ordered as HEADER_NAV_SECTIONS lists them, whatever order nav-items uses.
  sections.sort((a, b) => HEADER_NAV_SECTIONS.indexOf(a.label!) - HEADER_NAV_SECTIONS.indexOf(b.label!));

  const activeHref = activeId ? tabs.find((t) => t.id === activeId)?.href ?? null : null;

  function handleClick(e: MouseEvent<HTMLAnchorElement>, href: string, label: string) {
    // A modified click still opens a browser tab, as anywhere else.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    openTab(href, label);
  }

  if (sections.length === 0) return null;

  return (
    <nav className="hidden items-center gap-0.5 md:flex">
      {sections.map((section) => {
        const holdsActive = activeHref
          ? section.items.some((i) => activeHref === i.href || activeHref.startsWith(`${i.href}/`))
          : false;
        return (
          <DropdownMenu key={section.label}>
            <DropdownMenuTrigger
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                "text-white/85 hover:bg-white/15 hover:text-white focus-visible:outline-none",
                "data-[state=open]:bg-white/15 data-[state=open]:text-white",
                holdsActive && "bg-white/10 text-white",
              )}
            >
              {section.label}
              <ChevronDownIcon className="size-3.5 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = activeHref === item.href || activeHref?.startsWith(`${item.href}/`);
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      onClick={(e) => handleClick(e, item.href, item.label)}
                      className={cn("cursor-pointer gap-2.5", active && "bg-ledger/15 font-semibold text-ledger-dark")}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-ledger-dark" : "text-muted-foreground/80")} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}
