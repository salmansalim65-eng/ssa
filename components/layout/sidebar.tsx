import { Building2Icon } from "lucide-react";

import { SidebarNav } from "./sidebar-nav";

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex print:hidden">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <Building2Icon className="size-5" />
        Rental &amp; Accounting ERP
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav />
      </div>
    </aside>
  );
}
