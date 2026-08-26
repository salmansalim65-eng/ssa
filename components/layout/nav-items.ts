import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboardIcon,
  Building2Icon,
  BuildingIcon,
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
  ScaleIcon,
  ListOrderedIcon,
  HomeIcon,
  Users2Icon,
  ShoppingCartIcon,
  SlidersHorizontalIcon,
  LineChartIcon,
  PieChartIcon,
  WalletIcon,
  ReceiptIcon,
  BadgeDollarSignIcon,
  CalendarRangeIcon,
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
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
      { label: "Financial Dashboard", href: "/reports/financial-dashboard", icon: PieChartIcon },
    ],
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
    label: "Sales",
    items: [{ label: "Asset Sales", href: "/sales", icon: BadgeDollarSignIcon }],
  },
  {
    label: "Rental",
    items: [
      { label: "Tenants", href: "/rental/tenants", icon: UsersIcon },
      { label: "UAE Rent Invoice", href: "/rental/uae/leases", icon: ReceiptIcon },
      { label: "HH Rent Invoice", href: "/rental/uae/hh-lease", icon: ReceiptIcon },
      { label: "PK Rent Invoice", href: "/rental/pk/leases", icon: ReceiptIcon },
    ],
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
      { label: "Opening Balances", href: "/accounting/vouchers/opening_balance_voucher", icon: ScaleIcon },
      { label: "Voucher Register", href: "/accounting/voucher-register", icon: ListOrderedIcon },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "General Ledger", href: "/reports/general-ledger", icon: BookOpenIcon },
      { label: "Trial Balance", href: "/reports/trial-balance", icon: ScaleIcon },
      { label: "Balance Sheet", href: "/reports/balance-sheet", icon: LandmarkIcon },
      { label: "Profit & Loss", href: "/reports/profit-and-loss", icon: LineChartIcon },
      { label: "Expense Report", href: "/reports/expense-report", icon: WalletIcon },
      { label: "Cash Book", href: "/reports/cash-book", icon: CoinsIcon },
      { label: "Bank Book", href: "/reports/bank-book", icon: Building2Icon },
      { label: "Rental Property Report", href: "/reports/property-report", icon: BuildingIcon },
      { label: "Asset Register", href: "/reports/asset-register", icon: HomeIcon },
      { label: "Asset Valuation", href: "/reports/asset-valuation", icon: TrendingUpIcon },
      { label: "Purchase Report", href: "/reports/purchase-report", icon: ShoppingCartIcon },
      { label: "Sale Report", href: "/reports/sale-report", icon: BadgeDollarSignIcon },
      { label: "Rental Income", href: "/reports/rental-income", icon: ReceiptIcon },
      { label: "Rent Report", href: "/reports/rent-report", icon: CalendarRangeIcon },
      { label: "Outstanding Rent", href: "/reports/outstanding-rent", icon: ClockIcon },
      { label: "Currency Exchange", href: "/reports/currency-exchange", icon: ArrowUpFromLineIcon },
    ],
  },
];
