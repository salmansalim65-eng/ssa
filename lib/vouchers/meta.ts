import { VOUCHER_TYPES, type VoucherType } from "@/types/database.types";

export { VOUCHER_TYPES };
export type { VoucherType };

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  purchase_voucher: "Purchase Voucher",
  receipt_voucher: "Receipt Voucher",
  payment_voucher: "Payment Voucher",
  pdc_payment_voucher: "Post-Dated Payment Voucher",
  pdc_receipt_voucher: "Post-Dated Receipt Voucher",
  cheque_return_voucher: "Cheque Return Voucher",
  journal_voucher: "Journal Voucher",
  jv_maintenance_voucher: "JV Service Charges",
  opening_balance_voucher: "Opening Balance Voucher",
  uae_rent_invoice: "UAE Rent Invoice",
  pk_rent_invoice: "Pakistan Rent Invoice",
  asset_sales: "Asset Sale Voucher",
};

// The 8 voucher types Phase 5 ships end-user screens for. The remaining
// VOUCHER_TYPES (purchase_voucher, uae_rent_invoice, pk_rent_invoice,
// asset_sales) get their own dedicated screens in Phases 7/9/10/11 —
// they share the same engine but have business-document-specific fields
// that don't fit this phase's generic voucher pages.
export const PHASE5_VOUCHER_TYPES = [
  "receipt_voucher",
  "payment_voucher",
  "pdc_payment_voucher",
  "pdc_receipt_voucher",
  "cheque_return_voucher",
  "journal_voucher",
  "jv_maintenance_voucher",
  "opening_balance_voucher",
] as const;
export type Phase5VoucherType = (typeof PHASE5_VOUCHER_TYPES)[number];

export function isPhase5VoucherType(value: string): value is Phase5VoucherType {
  return (PHASE5_VOUCHER_TYPES as readonly string[]).includes(value);
}

// Phase 5 types share one generic route; Phases 7/9/10/11 each ship their
// own dedicated screens outside /accounting/vouchers — centralized here so
// every list that links to a voucher (Voucher Register, Dashboard "recent
// transactions", ...) resolves the same way instead of re-deriving it.
export function voucherHref(voucherType: VoucherType, voucherId: string): string {
  switch (voucherType) {
    case "purchase_voucher":
      return `/purchases/${voucherId}`;
    case "uae_rent_invoice":
      return `/rental/uae/invoices/${voucherId}`;
    case "pk_rent_invoice":
      return `/rental/pk/invoices/${voucherId}`;
    case "asset_sales":
      return `/sales/${voucherId}`;
    default:
      return `/accounting/vouchers/${voucherType}/${voucherId}`;
  }
}

export const VOUCHER_TYPE_DEFAULT_PREFIX: Record<VoucherType, string> = {
  purchase_voucher: "PV",
  receipt_voucher: "RV",
  payment_voucher: "PY",
  pdc_payment_voucher: "PDP",
  pdc_receipt_voucher: "PDR",
  cheque_return_voucher: "CR",
  journal_voucher: "JV",
  jv_maintenance_voucher: "JVM",
  opening_balance_voucher: "OB",
  uae_rent_invoice: "UAE",
  pk_rent_invoice: "PKR",
  asset_sales: "SV",
};
