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
 * What it does NOT refuse is money paid ahead. The agent settles his statement
 * and adds next month's rent before that month's sheet exists, so there is
 * nothing yet to adjust it against; and a long lease is invoiced a year out, so
 * there is almost always a bill outstanding that this money was never for.
 * Insisting on the last fil would make an honest advance unrecordable. The rule
 * is therefore about what has fallen DUE: everything owed by the receipt's own
 * date must be settled before any of the money is left on account.
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

  const { data: voucher } = await supabase
    .schema("accounting")
    .from("receipt_vouchers")
    .select("receipt_date")
    .eq("id", receiptId)
    .maybeSingle();
  const receiptDate = (voucher?.receipt_date as string | null) ?? new Date().toISOString().slice(0, 10);

  // What is still owed, by account. These bills already have THIS receipt's
  // adjustments taken off them, so what is left is what the receipt failed to
  // settle. Only the bills due by the receipt's own date count: rent billed for
  // a month still ahead is not money this payment was withheld from.
  const bills = await loadOutstandingRentBills(companyId);
  const dueByAccount = new Map<string, number>();
  for (const b of bills) {
    if (!b.accountId) continue;
    if (b.dueDate && b.dueDate > receiptDate) continue;
    dueByAccount.set(b.accountId, round2((dueByAccount.get(b.accountId) ?? 0) + b.billAmount));
  }

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
    if (adjusted === amount) continue;

    // Money left on account is allowed — but only once nothing that has
    // already fallen due is still waiting for it.
    const stillDue = dueByAccount.get(line.account_id as string) ?? 0;
    if (stillDue <= 0) continue;

    return (
      `Line ${line.line_no} leaves ${round2(amount - adjusted)} on account while ` +
      `${stillDue} of rent is already due. Open the receipt and adjust that much ` +
      `against the bills — anything over what is due may be left as an advance, ` +
      `but rent that has fallen due must not stay outstanding with the money in ` +
      `the bank.`
    );
  }
  return null;
}
