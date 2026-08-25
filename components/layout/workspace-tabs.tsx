"use client";

import { type ReactNode } from "react";
import { XIcon, HomeIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWorkspace, setActive, closeTab, goHome } from "./workspace-store";

// Renders the in-app tab strip and the content area. The base "home" content
// (the current route) shows when no tab is focused; each open tab renders its
// route inside an isolated iframe that stays mounted, so switching tabs never
// reloads or loses a report/voucher's state.
export function WorkspaceTabs({ children }: { children: ReactNode }) {
  const { tabs, activeId } = useWorkspace();
  const hasTabs = tabs.length > 0;
  const showHome = activeId === null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hasTabs && (
        <div className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b bg-muted/40 px-2 py-1">
          <button
            type="button"
            onClick={goHome}
            title="Home"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              showHome ? "bg-ledger/15 text-ledger-dark" : "text-muted-foreground hover:bg-foreground/[0.06]",
            )}
          >
            <HomeIcon className="size-3.5" />
            Home
          </button>
          {tabs.map((t) => {
            const active = t.id === activeId;
            return (
              <div
                key={t.id}
                className={cn(
                  "group inline-flex items-center gap-1 rounded-md pl-2.5 pr-1 text-xs font-medium transition-colors",
                  active ? "bg-ledger/15 text-ledger-dark" : "text-muted-foreground hover:bg-foreground/[0.06]",
                )}
              >
                <button type="button" onClick={() => setActive(t.id)} className="max-w-[12rem] truncate py-1.5">
                  {t.title}
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(t.id)}
                  aria-label={`Close ${t.title}`}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-foreground/10"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {/* Base / home surface (the current route). The --vh-offset drives
            full-height reports (viewport minus the header) in the top window. */}
        <div className={cn("h-full overflow-auto p-4 [--vh-offset:5.5rem] sm:p-6 sm:[--vh-offset:6.5rem]", !showHome && "hidden")}>
          {children}
        </div>

        {/* One iframe per open tab; only the active one is visible, but all stay
            mounted so their state is preserved when switching. */}
        {tabs.map((t) => (
          <iframe
            key={t.id}
            src={t.href}
            title={t.title}
            className={cn(
              "absolute inset-0 h-full w-full border-0 bg-background",
              t.id === activeId ? "block" : "hidden",
            )}
          />
        ))}
      </div>
    </div>
  );
}
