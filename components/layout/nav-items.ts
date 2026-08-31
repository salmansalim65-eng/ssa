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
  /** Permission module gating visibility. An item is shown only when the user
   * has 'view' on this module (admins see everything). Omit for always-visible. */
  module?: string;
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
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon, module: "dashboard" },
      { label: "Financial Dashboard", href: "/reports/financial-dashboard", icon: PieChartIcon, module: "reports" },
    ],
  },
  {
    label: "Assets",
    items: [
      { label: "Assets", href: "/assets", icon: HomeIcon, module: "assets" },
      { label: "Suppliers", href: "/assets/suppliers", icon: Users2Icon, module: "assets" },
    ],
  },
  {
    label: "Purchases",
    items: [{ label: "Purchase Vouchers", href: "/purchases", icon: ShoppingCartIcon, module: "purchase_voucher" }],
  },
  {
    label: "Sales",
    items: [{ label: "Asset Sales", href: "/sales", icon: BadgeDollarSignIcon, module: "asset_sales" }],
  },
  {
    label: "Rental",
    items: [
      { label: "Tenants", href: "/rental/tenants", icon: UsersIcon, module: "tenants" },
      { label: "UAE Rent Invoice", href: "/rental/uae/leases", icon: ReceiptIcon, module: "uae_rent_invoice" },
      { label: "HH Rent Invoice", href: "/rental/uae/hh-lease", icon: ReceiptIcon, module: "uae_rent_invoice" },
      { label: "PK Rent Invoice", href: "/rental/pk/leases", icon: ReceiptIcon, module: "pk_rent_invoice" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Company", href: "/admin/companies", icon: Building2Icon, module: "companies" },
      { label: "Users", href: "/admin/users", icon: UsersIcon, module: "users" },
      { label: "Roles & Permissions", href: "/admin/roles", icon: ShieldIcon, module: "roles" },
    ],
  },
  {
    label: "Currency",
    items: [
      { label: "Currencies", href: "/admin/currencies", icon: CoinsIcon, module: "currencies" },
      { label: "Exchange Rates", href: "/admin/exchange-rates", icon: TrendingUpIcon, module: "exchange_rates" },
    ],
  },
  {
    label: "Accounting",
    items: [
      { label: "Chart of Accounts", href: "/accounting/chart-of-accounts", icon: ListTreeIcon, module: "chart_of_accounts" },
      { label: "Cost Centers", href: "/accounting/cost-centers", icon: LandmarkIcon, module: "cost_centers" },
      { label: "Document Sequences", href: "/admin/document-sequences", icon: HashIcon, module: "document_sequences" },
      { label: "Approval Workflows", href: "/admin/approval-workflows", icon: GitBranchIcon, module: "approval_workflows" },
      { label: "Posting Templates", href: "/admin/posting-templates", icon: SlidersHorizontalIcon, module: "posting_templates" },
    ],
  },
  {
    label: "Vouchers",
    items: [
      { label: "Receipt Vouchers", href: "/accounting/vouchers/receipt_voucher", icon: ArrowDownToLineIcon, module: "receipt_voucher" },
      { label: "Payment Vouchers", href: "/accounting/vouchers/payment_voucher", icon: ArrowUpFromLineIcon, module: "payment_voucher" },
      { label: "PDC Payments", href: "/accounting/vouchers/pdc_payment_voucher", icon: ClockIcon, module: "pdc_payment_voucher" },
      { label: "PDC Receipts", href: "/accounting/vouchers/pdc_receipt_voucher", icon: ClockIcon, module: "pdc_receipt_voucher" },
      { label: "Cheque Returns", href: "/accounting/vouchers/cheque_return_voucher", icon: RotateCcwIcon, module: "cheque_return_voucher" },
      { label: "Journal Vouchers", href: "/accounting/vouchers/journal_voucher", icon: BookOpenIcon, module: "journal_voucher" },
      { label: "Multi-Currency Journal", href: "/accounting/vouchers/multi_currency_journal", icon: BookOpenIcon, module: "multi_currency_journal" },
      { label: "Opening Balances", href: "/accounting/vouchers/opening_balance_voucher", icon: ScaleIcon, module: "opening_balance_voucher" },
      { label: "Voucher Register", href: "/accounting/voucher-register", icon: ListOrderedIcon, module: "reports" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "General Ledger", href: "/reports/general-ledger", icon: BookOpenIcon, module: "reports" },
      { label: "Trial Balance", href: "/reports/trial-balance", icon: ScaleIcon, module: "reports" },
      { label: "Balance Sheet", href: "/reports/balance-sheet", icon: LandmarkIcon, module: "reports" },
      { label: "Profit & Loss", href: "/reports/profit-and-loss", icon: LineChartIcon, module: "reports" },
      { label: "Expense Report", href: "/reports/expense-report", icon: WalletIcon, module: "reports" },
      { label: "Cash Book", href: "/reports/cash-book", icon: CoinsIcon, module: "reports" },
      { label: "Bank Book", href: "/reports/bank-book", icon: Building2Icon, module: "reports" },
      { label: "Rental Property Report", href: "/reports/property-report", icon: BuildingIcon, module: "reports" },
      { label: "Asset Register", href: "/reports/asset-register", icon: HomeIcon, module: "reports" },
      { label: "Asset Valuation", href: "/reports/asset-valuation", icon: TrendingUpIcon, module: "reports" },
      { label: "Purchase Report", href: "/reports/purchase-report", icon: ShoppingCartIcon, module: "reports" },
      { label: "Sale Report", href: "/reports/sale-report", icon: BadgeDollarSignIcon, module: "reports" },
      { label: "Rental Income", href: "/reports/rental-income", icon: ReceiptIcon, module: "reports" },
      { label: "Rent Report", href: "/reports/rent-report", icon: CalendarRangeIcon, module: "reports" },
      { label: "Outstanding Rent", href: "/reports/outstanding-rent", icon: ClockIcon, module: "reports" },
      { label: "Currency Exchange", href: "/reports/currency-exchange", icon: ArrowUpFromLineIcon, module: "reports" },
    ],
  },
];

// Filter nav sections to the modules a user may view. `allowed` null means no
// restriction (admin). Items without a module are always kept; empty sections
// after filtering are dropped.
export function filterNavSections(sections: NavSection[], allowed: string[] | null): NavSection[] {
  if (allowed === null) return sections;
  const set = new Set(allowed);
  return sections
    .map((s) => ({ ...s, items: s.items.filter((it) => !it.module || set.has(it.module)) }))
    .filter((s) => s.items.length > 0);
}
