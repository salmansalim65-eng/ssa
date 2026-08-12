"use client";

import { useState } from "react";
import Image from "next/image";
import { Building2Icon, CalendarDaysIcon, MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import { Breadcrumbs } from "./breadcrumbs";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

// The application header band: the darkest chrome in the shell, spanning the
// content column and visually continuous with the sidebar's navy brand cap so
// the whole top strip reads as one professional header.
export function Header({
  fullName,
  email,
  companyName,
}: {
  fullName: string;
  email: string;
  companyName: string;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Same calendar-day string on server and client; the span carries
  // suppressHydrationWarning to tolerate a midnight boundary.
  const todayLabel = formatDate(new Date().toISOString().slice(0, 10));

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-ledger-dark bg-ledger-dark px-4 text-white print:hidden">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/15 hover:text-white md:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </Button>
        <SheetContent side="left" className="flex w-64 flex-col p-0">
          <SheetHeader className="shrink-0 border-b bg-ledger p-4 text-white">
            <SheetTitle className="flex items-center gap-2.5 text-white">
              <Image src="/logo.svg" alt="SSA logo" width={28} height={28} className="size-7" />
              Rental &amp; Accounting ERP
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="min-w-0 [&_a]:text-white/75 [&_a:hover]:text-white [&_span]:text-white [&_svg]:text-white/60">
        <Breadcrumbs />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="hidden items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-medium text-white sm:inline-flex">
          <CalendarDaysIcon className="size-3.5 text-white/70" />
          <span className="tabular-nums" suppressHydrationWarning>
            {todayLabel}
          </span>
        </span>
        {companyName && (
          <span className="hidden items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-medium text-white sm:inline-flex">
            <Building2Icon className="size-3.5 text-white/70" />
            {companyName}
          </span>
        )}
        <div className="[&_button]:text-white [&_button:hover]:bg-white/15 [&_button:hover]:text-white [&_svg]:text-white">
          <ThemeToggle />
        </div>
        <div className="mx-1 hidden h-6 w-px bg-white/20 sm:block" />
        <div className="[&_button]:text-white [&_button:hover]:bg-white/15 [&_button:hover]:text-white">
          <UserMenu fullName={fullName} email={email} />
        </div>
      </div>
    </header>
  );
}
