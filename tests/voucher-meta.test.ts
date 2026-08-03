import { describe, expect, it } from "vitest";

import {
  VOUCHER_TYPE_DEFAULT_PREFIX,
  VOUCHER_TYPE_LABELS,
  VOUCHER_TYPES,
  isPhase5VoucherType,
  voucherHref,
} from "@/lib/vouchers/meta";

describe("voucherHref", () => {
  it("routes each Phase 7/9/10/11 voucher type to its own dedicated screen", () => {
    expect(voucherHref("purchase_voucher", "v1")).toBe("/purchases/v1");
    expect(voucherHref("uae_rent_invoice", "v2")).toBe("/rental/uae/invoices/v2");
    expect(voucherHref("pk_rent_invoice", "v3")).toBe("/rental/pk/invoices/v3");
    expect(voucherHref("asset_sales", "v4")).toBe("/sales/v4");
  });

  it("falls back to the generic Phase 5 voucher route for every other type", () => {
    expect(voucherHref("receipt_voucher", "v5")).toBe("/accounting/vouchers/receipt_voucher/v5");
    expect(voucherHref("journal_voucher", "v6")).toBe("/accounting/vouchers/journal_voucher/v6");
  });
});

describe("voucher type metadata completeness", () => {
  it("has a label for every voucher type", () => {
    for (const type of VOUCHER_TYPES) {
      expect(VOUCHER_TYPE_LABELS[type], `missing label for ${type}`).toBeTruthy();
    }
  });

  it("has a default document-number prefix for every voucher type", () => {
    for (const type of VOUCHER_TYPES) {
      expect(VOUCHER_TYPE_DEFAULT_PREFIX[type], `missing prefix for ${type}`).toBeTruthy();
    }
  });

  it("routes every non-Phase-5 voucher type somewhere other than the generic route", () => {
    for (const type of VOUCHER_TYPES) {
      if (isPhase5VoucherType(type)) continue;
      expect(voucherHref(type, "id")).not.toBe(`/accounting/vouchers/${type}/id`);
    }
  });
});
