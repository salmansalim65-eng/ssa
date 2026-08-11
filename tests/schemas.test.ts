import { describe, expect, it } from "vitest";

import { assetSaleSchema } from "@/features/assets/sale/schemas";
import { pkLeaseSchema } from "@/features/rental/pk-leases/schemas";
import { generatePkInvoiceSchema, recordPkPaymentSchema } from "@/features/rental/pk-rent-invoices/schemas";
import { uaeLeaseSchema } from "@/features/rental/uae-leases/schemas";

// Valid-shaped v4 UUIDs (version nibble 4, variant nibble in 8-b) — zod's
// .uuid() validator checks both, so all-same-digit fixtures like
// "11111111-1111-1111-1111-111111111111" fail validation.
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

describe("assetSaleSchema", () => {
  const valid = {
    customerAccountId: UUID_A,
    saleDate: "2026-01-15",
    currencyId: UUID_B,
    exchangeRate: 1,
    pakExch: 3.5,
    lines: [{ fixedAssetAccountId: UUID_C, gross: 500000, remarks: "" }],
  };

  it("accepts a valid sale", () => {
    expect(assetSaleSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a total value of zero", () => {
    expect(
      assetSaleSchema.safeParse({ ...valid, lines: [{ fixedAssetAccountId: UUID_C, gross: 0 }] }).success,
    ).toBe(false);
  });

  it("rejects a sale with no lines", () => {
    expect(assetSaleSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
  });

  it("rejects a missing customer account", () => {
    expect(assetSaleSchema.safeParse({ ...valid, customerAccountId: "" }).success).toBe(false);
  });
});

describe("uaeLeaseSchema", () => {
  const valid = {
    assetId: UUID_A,
    tenantId: UUID_B,
    leaseStart: "2026-01-01",
    leaseEnd: "2026-12-31",
    rentalAmount: 5000,
    rentCycle: "monthly" as const,
    securityDeposit: 10000,
    currencyId: UUID_C,
    voucherDate: "2026-01-01",
  };

  it("accepts a valid lease", () => {
    expect(uaeLeaseSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a lease ending on or before it starts", () => {
    expect(uaeLeaseSchema.safeParse({ ...valid, leaseEnd: "2026-01-01" }).success).toBe(false);
    expect(uaeLeaseSchema.safeParse({ ...valid, leaseEnd: "2025-12-31" }).success).toBe(false);
  });

  it("rejects an invalid rent cycle", () => {
    expect(uaeLeaseSchema.safeParse({ ...valid, rentCycle: "weekly" }).success).toBe(false);
  });

  it("requires a voucher date", () => {
    expect(uaeLeaseSchema.safeParse({ ...valid, voucherDate: "" }).success).toBe(false);
  });
});

describe("pkLeaseSchema", () => {
  const valid = {
    assetId: UUID_A,
    tenantId: UUID_B,
    leaseStart: "2026-01-01",
    leaseEnd: "2026-12-31",
    monthlyRent: 50000,
    rentCycle: "monthly",
    advanceRent: 100000,
    securityDeposit: 50000,
    currencyId: UUID_C,
    voucherDate: "2026-01-01",
  };

  it("accepts a valid lease", () => {
    expect(pkLeaseSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-positive monthly rent", () => {
    expect(pkLeaseSchema.safeParse({ ...valid, monthlyRent: 0 }).success).toBe(false);
  });

  it("rejects negative advance rent", () => {
    expect(pkLeaseSchema.safeParse({ ...valid, advanceRent: -1 }).success).toBe(false);
  });

  it("requires a voucher date", () => {
    expect(pkLeaseSchema.safeParse({ ...valid, voucherDate: "" }).success).toBe(false);
  });
});

describe("generatePkInvoiceSchema", () => {
  it("accepts an invoice with no utility charges and no advance adjustment", () => {
    const result = generatePkInvoiceSchema.safeParse({ scheduleId: UUID_A, utilityCharges: [], advanceAdjusted: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts utility charges of a known type", () => {
    const result = generatePkInvoiceSchema.safeParse({
      scheduleId: UUID_A,
      utilityCharges: [{ utilityType: "electricity", amount: 150, description: "" }],
      advanceAdjusted: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown utility type", () => {
    const result = generatePkInvoiceSchema.safeParse({
      scheduleId: UUID_A,
      utilityCharges: [{ utilityType: "internet", amount: 50 }],
      advanceAdjusted: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative advance adjustment", () => {
    const result = generatePkInvoiceSchema.safeParse({ scheduleId: UUID_A, utilityCharges: [], advanceAdjusted: -10 });
    expect(result.success).toBe(false);
  });
});

describe("recordPkPaymentSchema", () => {
  it("rejects a zero or negative payment amount", () => {
    const base = { paymentDate: "2026-01-15", cashBankAccountId: UUID_A };
    expect(recordPkPaymentSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(recordPkPaymentSchema.safeParse({ ...base, amount: -5 }).success).toBe(false);
    expect(recordPkPaymentSchema.safeParse({ ...base, amount: 5 }).success).toBe(true);
  });
});
