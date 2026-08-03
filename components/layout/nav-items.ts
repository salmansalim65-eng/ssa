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
  HashIcon,
  GitBranchIcon,
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  ClockIcon,
  RotateCcwIcon,
  BookOpenIcon,
  WrenchIcon,
  ScaleIcon,
  ListOrderedIcon,
  HomeIcon,
  Users2Icon,
  ShoppingCartIcon,
  SlidersHorizontalIcon,
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
    label: "Assets",
    items: [
      { label: "Assets", href: "/assets", icon: HomeIcon },
      { label: "Suppliers", href: "/assets/suppliers", icon: Users2Icon },
    ],
  },
  {
    label: "Purchases",
    items: [{ label: "Purchase Vouchers", href: "/purchases", icon: ShoppingCartIcon }],
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
      { label: "Document Sequences", href: "/admin/document-sequences", icon: HashIcon },
      { label: "Approval Workflows", href: "/admin/approval-workflows", icon: GitBranchIcon },
      { label: "Posting Templates", href: "/admin/posting-templates", icon: SlidersHorizontalIcon },
    ],
  },
  {
    label: "Vouchers",
    items: [
      { label: "Receipt Vouchers", href: "/accounting/vouchers/receipt_voucher", icon: ArrowDownToLineIcon },
      { label: "Payment Vouchers", href: "/accounting/vouchers/payment_voucher", icon: ArrowUpFromLineIcon },
      { label: "PDC Payments", href: "/accounting/vouchers/pdc_payment_voucher", icon: ClockIcon },
      { label: "PDC Receipts", href: "/accounting/vouchers/pdc_receipt_voucher", icon: ClockIcon },
      { label: "Cheque Returns", href: "/accounting/vouchers/cheque_return_voucher", icon: RotateCcwIcon },
      { label: "Journal Vouchers", href: "/accounting/vouchers/journal_voucher", icon: BookOpenIcon },
      { label: "JV Maintenance", href: "/accounting/vouchers/jv_maintenance_voucher", icon: WrenchIcon },
      { label: "Opening Balances", href: "/accounting/vouchers/opening_balance_voucher", icon: ScaleIcon },
      { label: "Voucher Register", href: "/accounting/voucher-register", icon: ListOrderedIcon },
    ],
  },
];
