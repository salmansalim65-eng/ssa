import "server-only";

import { createClient } from "@/lib/supabase/server";
import { loadOutstandingRentBills } from "@/lib/rental/outstanding-bills";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Why a receipt must not reach the ledger unadjusted.
 *
 * Settling rent takes two things: the money moves on the party's account, and
 * the invoices it pays are marked down. Only the second reaches the Rent
 * Balance, which is built from invoices and not from the party's ledger. Do the
 * first without the second and the books look paid while every report still
 * calls the rent outstanding — money in the bank, the tenant's ledger square,
 * and the overdue figure exactly where it was.
 *
 * The receipt form already refuses to save a line that has outstanding bills
 * and is not adjusted against them. This is the same rule at posting time,
 * because a receipt does not always come from the form: Copy builds one
 * server-side with no adjustments — rightly, since the old receipt's
 * adjustments belong to the old receipt — and that draft could be posted
 * straight from the detail page without ever meeting the form's check.
 *
 * Returns a message naming the line at fault, or null when there is nothing to
 * adjust against.
 */
export async function unadjustedReceiptError(
  companyId: string,
  receiptId: string,
): Promise<string | null> {
  const supabase = await createClient();

  const { data: lines } = await supabase
    .schema("accounting")
    .from("receipt_voucher_lines")
    .select("id, line_no, account_id, amount")
    .eq("voucher_id", receiptId)
    .order("line_no");
  if (!lines?.length) return null;

  // Only an account with something still outstanding can be left unadjusted.
  const bills = await loadOutstandingRentBills(companyId);
  const owing = new Set(bills.map((b) => b.accountId).filter(Boolean) as string[]);
  const needing = lines.filter((l) => owing.has(l.account_id as string) && Number(l.amount) > 0);
  if (needing.length === 0) return null;

  const { data: allocations } = await supabase
    .schema("rental")
    .from("receipt_invoice_allocations")
    .select("receipt_line_id, amount")
    .eq("receipt_voucher_id", receiptId);
  const adjustedByLine = new Map<string, number>();
  for (const a of allocations ?? []) {
    const key = a.receipt_line_id as string | null;
    if (!key) continue;
    adjustedByLine.set(key, round2((adjustedByLine.get(key) ?? 0) + Number(a.amount)));
  }

  for (const line of needing) {
    const amount = round2(Number(line.amount));
    const adjusted = adjustedByLine.get(line.id as string) ?? 0;
    if (adjusted !== amount) {
      return (
        `Line ${line.line_no} is not adjusted against the outstanding bills ` +
        `(${adjusted} of ${amount}). Open the receipt, adjust the full amount ` +
        `against the bills and save — otherwise the money moves but the rent ` +
        `stays outstanding.`
      );
    }
  }
  return null;
}
