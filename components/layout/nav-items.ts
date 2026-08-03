import type { LucideIcon } from "lucide-react";
import { LayoutDashboardIcon, Building2Icon, UsersIcon, ShieldIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Only routes that exist ship here. Later phases add their own section as
// each module lands, rather than linking to placeholder pages.
export const navSections: NavSection[] = [
  {
    label: "",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon }],
  },
  {
    label: "Administration",
    items: [
      { label: "Company", href: "/admin/companies", icon: Building2Icon },
      { label: "Users", href: "/admin/users", icon: UsersIcon },
      { label: "Roles & Permissions", href: "/admin/roles", icon: ShieldIcon },
    ],
  },
];
