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
  jv_maintenance_voucher: "JV Maintenance Voucher",
  opening_balance_voucher: "Opening Balance Voucher",
  uae_rent_invoice: "UAE Rent Invoice",
  pk_rent_invoice: "Pakistan Rent Invoice",
  asset_sales: "Asset Sale Voucher",
};

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
