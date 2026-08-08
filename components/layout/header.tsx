"use client";

import { useState } from "react";
import Image from "next/image";
import { Building2Icon, MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-header-border bg-header px-4 text-header-foreground print:hidden">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Button
          variant="ghost"
          size="icon"
          className="text-header-foreground hover:bg-header-accent hover:text-header-foreground md:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </Button>
        <SheetContent side="left" className="flex w-64 flex-col p-0">
          <SheetHeader className="shrink-0 border-b bg-header p-4 text-header-foreground">
            <SheetTitle className="flex items-center gap-2.5 text-header-foreground">
              <Image src="/logo.svg" alt="SSA logo" width={28} height={28} className="size-7" />
              Rental &amp; Accounting ERP
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5">
        {companyName && (
          <span className="hidden items-center gap-1.5 rounded-md border border-header-border bg-header-accent px-2.5 py-1 text-xs font-medium text-header-foreground sm:inline-flex">
            <Building2Icon className="size-3.5 text-header-muted" />
            {companyName}
          </span>
        )}
        <ThemeToggle />
        <div className="mx-1 hidden h-6 w-px bg-header-border sm:block" />
        <UserMenu fullName={fullName} email={email} />
      </div>
    </header>
  );
}
