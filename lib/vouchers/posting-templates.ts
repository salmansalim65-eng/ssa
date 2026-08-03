import type { VoucherType } from "@/types/database.types";

export interface PostingTemplateRole {
  role: string;
  label: string;
  side: "debit" | "credit";
}

/**
 * Voucher types whose accounting treatment is fixed (always the same two
 * GL accounts) declare their required roles here. Phase 5's vouchers are
 * deliberately absent — the user picks both accounts directly since the
 * contra genuinely varies per transaction there. Phases 9/10/11 add their
 * own entries here when they ship.
 */
export const POSTING_TEMPLATE_ROLES: Partial<Record<VoucherType, PostingTemplateRole[]>> = {
  purchase_voucher: [
    { role: "fixed_asset_property", label: "Fixed Asset (Property)", side: "debit" },
    { role: "supplier_payable", label: "Supplier Payable", side: "credit" },
  ],
};
