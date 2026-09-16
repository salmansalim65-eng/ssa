"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  createJournalEntry,
  EDITABLE_STATUSES,
  ensureCanEditVoucher,
  getCurrentCompanyId,
  postVoucher,
  type EntryLineInput,
} from "@/lib/vouchers/engine";
import { expenseVoucherSchema, type ExpenseVoucherInput } from "./schemas";

const LIST_PATH = "/accounting/vouchers/expense_voucher";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function lineDescription(remarks?: string) {
  return remarks?.trim() ? remarks.trim() : "Expense";
}

/**
 * Each expense line debits its own account with its own cost centre; the whole
 * voucher credits the one cash or bank account it was paid from.
 */
function toEntryLines(input: ExpenseVoucherInput, total: number): EntryLineInput[] {
  return [
    ...input.lines.map((l) => ({
      accountId: l.accountId,
      costCenterId: l.costCenterId || null,
      debit: round2(l.amount),
      credit: 0,
      description: lineDescription(l.remarks),
    })),
    {
      accountId: input.creditAccountId,
      costCenterId: null,
      debit: 0,
      credit: total,
      description: input.paidTo?.trim() ? `Paid to ${input.paidTo.trim()}` : "Expense",
    },
  ];
}

function toLineRows(voucherId: string, input: ExpenseVoucherInput) {
  return input.lines.map((l, index) => ({
    voucher_id: voucherId,
    line_no: index + 1,
    account_id: l.accountId,
    cost_center_id: l.costCenterId || null,
    tag_id: l.tagId || null,
    amount: round2(l.amount),
    remarks: l.remarks || null,
  }));
}

export async function createExpenseVoucher(input: ExpenseVoucherInput, options?: { autoPost?: boolean }) {
  const parsed = expenseVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("expense_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const total = round2(parsed.data.lines.reduce((sum, l) => sum + l.amount, 0));
  if (total <= 0) return { error: "Total must be greater than zero" };
  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "expense_voucher",
    voucherId,
    entryDate: parsed.data.expenseDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || "Expense",
    createdBy,
    lines: toEntryLines(parsed.data, total),
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("expense_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    expense_date: parsed.data.expenseDate,
    credit_account_id: parsed.data.creditAccountId,
    currency_id: parsed.data.currencyId,
    exchange_rate: je.exchangeRate,
    total_amount: total,
    paid_to: parsed.data.paidTo || null,
    narration: parsed.data.narration || null,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  const { error: linesError } = await supabase
    .schema("accounting")
    .from("expense_voucher_lines")
    .insert(toLineRows(voucherId, parsed.data));
  if (linesError) return { error: linesError.message };

  revalidatePath(LIST_PATH);
  revalidatePath("/dashboard");

  // An expense voucher records money that has ALREADY left the box — it is not
  // a request for permission to spend. So it posts on the spot rather than
  // parking in a draft for someone to route by hand, and it skips the approval
  // workflow the larger vouchers go through.
  if (options?.autoPost !== false) {
    const warning = await tryPost(voucherId, je.journalEntryId);
    if (warning) return { success: true, id: voucherId, warning };
  }
  return { success: true, id: voucherId };
}

/**
 * Post, and hand back WHY if it could not be — a missing post permission, an
 * unbalanced entry. The voucher is saved either way, so this never throws: it
 * returns a message the form shows, instead of leaving a silent draft nobody
 * knows to chase.
 */
async function tryPost(voucherId: string, journalEntryId: string): Promise<string | null> {
  try {
    const result = await postExpenseVoucher(voucherId, journalEntryId);
    if (result && "error" in result) return notPosted(result.error);
    return null;
  } catch (e) {
    return notPosted(e instanceof Error ? e.message : String(e));
  }
}

/**
 * The one refusal worth translating. A voucher posts on creation now, so a role
 * that may CREATE one but not POST it leaves the money recorded nowhere — and
 * "Not permitted: expense_voucher.post" tells the person at the keyboard
 * nothing they can act on. The database trigger enforces this independently of
 * the app, so the tick is the only fix and the message says where it is.
 */
function notPosted(reason: string) {
  if (/not permitted.*expense_voucher|expense_voucher\.post/i.test(reason)) {
    return "Saved, but not posted: this role does not have the Post permission for Expense Voucher KHI. An administrator can tick it under Admin → Roles.";
  }
  return `Saved, but not posted: ${reason}`;
}

export async function updateExpenseVoucher(id: string, input: ExpenseVoucherInput) {
  const parsed = expenseVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("expense_vouchers")
    .select("journal_entry_id")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!v) return { error: "Voucher not found" };

  const jeId = v.journal_entry_id as string;
  const { data: je } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .select("status, created_by")
    .eq("id", jeId)
    .single();
  if (!je) return { error: "Voucher not found" };
  // The Edit permission, or your own voucher while it is unposted.
  const notAllowed = await ensureCanEditVoucher("expense_voucher", je);
  if (notAllowed) return { error: notAllowed };

  // A posted journal entry is immutable at the database level, so editing a
  // POSTED expense removes it outright and re-creates a replacement from the
  // edited values, re-posted with a new number — the route the receipt, payment,
  // PDC and cheque-return vouchers already take.
  if (je.status === "posted") {
    const removalError = await removePostedVoucher(supabase, id);
    if (removalError) return { error: removalError };

    const created = await createExpenseVoucher(parsed.data);
    if ("error" in created) return { error: created.error };

    revalidatePath(LIST_PATH);
    revalidatePath("/dashboard");
    return { success: true, id: created.id };
  }
  if (!EDITABLE_STATUSES.includes(je.status)) {
    return { error: "This expense voucher can no longer be edited" };
  }

  const total = round2(parsed.data.lines.reduce((sum, l) => sum + l.amount, 0));
  if (total <= 0) return { error: "Total must be greater than zero" };

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.expenseDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: parsed.data.exchangeRate,
      narration: parsed.data.narration || "Expense",
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  const { error: delLines } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", jeId);
  if (delLines) return { error: delLines.message };

  const entryLines = toEntryLines(parsed.data, total);
  const { error: insLines } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .insert(
      entryLines.map((l, index) => ({
        journal_entry_id: jeId,
        line_no: index + 1,
        account_id: l.accountId,
        cost_center_id: l.costCenterId,
        debit_amount: l.debit,
        credit_amount: l.credit,
        currency_id: parsed.data.currencyId,
        exchange_rate: parsed.data.exchangeRate,
        base_debit_amount: round2(l.debit * parsed.data.exchangeRate),
        base_credit_amount: round2(l.credit * parsed.data.exchangeRate),
        description: l.description,
      })),
    );
  if (insLines) return { error: insLines.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("expense_vouchers")
    .update({
      expense_date: parsed.data.expenseDate,
      credit_account_id: parsed.data.creditAccountId,
      currency_id: parsed.data.currencyId,
      exchange_rate: parsed.data.exchangeRate,
      total_amount: total,
      paid_to: parsed.data.paidTo || null,
      narration: parsed.data.narration || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  const { error: delOwn } = await supabase
    .schema("accounting")
    .from("expense_voucher_lines")
    .delete()
    .eq("voucher_id", id);
  if (delOwn) return { error: delOwn.message };
  const { error: insOwn } = await supabase
    .schema("accounting")
    .from("expense_voucher_lines")
    .insert(toLineRows(id, parsed.data));
  if (insOwn) return { error: insOwn.message };

  // Same rule as on create: the money is already spent, so the corrected
  // voucher posts rather than going back round an approver.
  const warning = await tryPost(id, jeId);

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  revalidatePath("/dashboard");
  return warning ? { success: true, id, warning } : { success: true, id };
}

/**
 * Take a posted expense voucher out of the ledger so the edit can be
 * re-created in its place.
 *
 * Prefers the expense voucher's OWN removal function, which lets the person who
 * raised a voucher correct it — an expense voucher posts on creation and is
 * raised by whoever spent the money, so needing an administrator for a Rs 500
 * grocery bill is not a workable rule.
 *
 * Falls back to the admin-only function where that one has not been installed
 * yet, so an administrator's edit keeps working either way and the only thing a
 * missing migration costs is the assistant's own correction.
 */
async function removePostedVoucher(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<string | null> {
  const { error } = await supabase
    .schema("accounting")
    .rpc("fn_delete_posted_expense_voucher", { p_id: id });
  if (!error) return null;
  // PGRST202 is PostgREST's "no such function"; 42883 is Postgres's own.
  const missing = error.code === "PGRST202" || error.code === "42883";
  if (!missing) return error.message;

  if (!(await isCurrentUserAdmin())) {
    return "Only administrators can edit a posted expense voucher.";
  }
  const { error: adminError } = await supabase
    .schema("accounting")
    .rpc("fn_admin_delete_posted_voucher", { p_voucher_type: "expense_voucher", p_id: id });
  return adminError ? adminError.message : null;
}

export async function postExpenseVoucher(id: string, journalEntryId: string) {
  await requirePermission("expense_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "expense_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("expense_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(LIST_PATH);
  revalidatePath("/dashboard");
  return { success: true, voucherNo: result.voucherNo };
}
