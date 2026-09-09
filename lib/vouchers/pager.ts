import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Phase5VoucherType } from "@/lib/vouchers/meta";

/**
 * The documents either side of the one on screen, so a run of them can be read
 * straight through instead of going back to the list between each.
 *
 * Every voucher and invoice table in the app is shaped the same way for this
 * purpose — id, company_id, voucher_no, created_at — so one function serves all
 * of them rather than each screen growing its own.
 *
 * "Either side" means in the list's own order, newest first: Previous is the row
 * above the document on its register, Next the row below it. Ordering is by
 * created_at, the key those lists already sort on; it is a timestamp to the
 * microsecond, so two documents of one kind sharing it is not a case worth
 * complicating this for. These tables are hard-deleted, so there is no
 * soft-delete filter to apply.
 */

export interface VoucherNeighbour {
  id: string;
  voucherNo: string | null;
}

/** Where each voucher type's header row lives. */
export const VOUCHER_TABLES: Record<Phase5VoucherType, string> = {
  receipt_voucher: "receipt_vouchers",
  payment_voucher: "payment_vouchers",
  pdc_payment_voucher: "pdc_payment_vouchers",
  pdc_receipt_voucher: "pdc_receipt_vouchers",
  cheque_return_voucher: "cheque_return_vouchers",
  journal_voucher: "journal_vouchers",
  jv_maintenance_voucher: "jv_maintenance_vouchers",
  opening_balance_voucher: "opening_balance_vouchers",
  multi_currency_journal: "multi_currency_journal_vouchers",
};

export async function getRecordNeighbours(
  schema: "accounting" | "rental" | "assets",
  table: string,
  companyId: string,
  id: string,
): Promise<{ prev: VoucherNeighbour | null; next: VoucherNeighbour | null }> {
  const supabase = await createClient();
  // The table always comes from a caller's literal or the map above, never from
  // user input. The cast is only to satisfy the generated table-name union.
  const from = () => supabase.schema(schema).from(table as "receipt_vouchers");

  const { data: current } = await from().select("created_at").eq("company_id", companyId).eq("id", id).maybeSingle();
  if (!current?.created_at) return { prev: null, next: null };

  const at = current.created_at as string;
  const [{ data: newer }, { data: older }] = await Promise.all([
    from()
      .select("id, voucher_no")
      .eq("company_id", companyId)
      .gt("created_at", at)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    from()
      .select("id, voucher_no")
      .eq("company_id", companyId)
      .lt("created_at", at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const asNeighbour = (row: { id: string; voucher_no: string | null } | null): VoucherNeighbour | null =>
    row ? { id: row.id, voucherNo: row.voucher_no } : null;
  return { prev: asNeighbour(newer), next: asNeighbour(older) };
}

/** The same, for one of the nine accounting voucher types. */
export async function getVoucherNeighbours(companyId: string, voucherType: Phase5VoucherType, id: string) {
  return getRecordNeighbours("accounting", VOUCHER_TABLES[voucherType], companyId, id);
}
