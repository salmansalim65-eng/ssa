"use client";

import { useState } from "react";
import { Building2Icon, MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Breadcrumbs } from "./breadcrumbs";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

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
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 print:hidden">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </Button>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b p-4">
            <SheetTitle>Rental &amp; Accounting ERP</SheetTitle>
          </SheetHeader>
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-2">
        {companyName && (
          <span className="hidden items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm sm:inline-flex">
            <Building2Icon className="size-3.5 text-muted-foreground" />
            {companyName}
          </span>
        )}
        <ThemeToggle />
        <UserMenu fullName={fullName} email={email} />
      </div>
    </header>
  );
}
