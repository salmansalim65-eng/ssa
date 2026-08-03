import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboardIcon,
  Building2Icon,
  UsersIcon,
  ShieldIcon,
  CoinsIcon,
  TrendingUpIcon,
  ListTreeIcon,
  LandmarkIcon,
} from "lucide-react";

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
  {
    label: "Currency",
    items: [
      { label: "Currencies", href: "/admin/currencies", icon: CoinsIcon },
      { label: "Exchange Rates", href: "/admin/exchange-rates", icon: TrendingUpIcon },
    ],
  },
  {
    label: "Accounting",
    items: [
      { label: "Chart of Accounts", href: "/accounting/chart-of-accounts", icon: ListTreeIcon },
      { label: "Cost Centers", href: "/accounting/cost-centers", icon: LandmarkIcon },
    ],
  },
];
