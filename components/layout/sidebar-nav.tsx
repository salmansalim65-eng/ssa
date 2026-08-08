"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { navSections } from "./nav-items";

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <nav className={cn("flex flex-col gap-5 py-4", collapsed ? "px-2" : "px-3")}>
      {navSections.map((section, sectionIndex) => (
        <div key={section.label || "root"}>
          {section.label &&
            (collapsed ? (
              sectionIndex > 0 && <div className="mx-2 mb-2 border-t border-sidebar-border" />
            ) : (
              <p className="px-3 pb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {section.label}
              </p>
            ))}
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
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
        </div>
      ))}
    </nav>
  );
}
