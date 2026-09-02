"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { actOnApproval, getCurrentCompanyId, submitForApproval } from "@/lib/vouchers/engine";
import type { VoucherType } from "@/types/database.types";
import { createReceiptVoucher, postReceiptVoucher } from "./receipt/actions";
import { createPaymentVoucher, postPaymentVoucher } from "./payment/actions";
import { createPdcPaymentVoucher, postPdcPaymentVoucher } from "./pdc-payment/actions";
import { createPdcReceiptVoucher, postPdcReceiptVoucher } from "./pdc-receipt/actions";
import { postChequeReturnVoucher } from "./cheque-return/actions";
import { createJournalVoucher, postJournalVoucher } from "./journal/actions";
import { createJvMaintenanceVoucher, postJvMaintenanceVoucher } from "./jv-maintenance/actions";
import { createOpeningBalanceVoucher, postOpeningBalanceVoucher } from "./opening-balance/actions";
import { postMultiCurrencyJournal } from "./multi-currency-journal/actions";

export async function submitVoucher(
  voucherType: VoucherType,
  voucherId: string,
  journalEntryId: string,
  amount: number,
) {
  await requirePermission(voucherType, "edit");
  const companyId = await getCurrentCompanyId();

  const result = await submitForApproval({ companyId, voucherType, voucherId, journalEntryId, amount });
  if ("error" in result) return { error: result.error };

  return { success: true };
}

export async function deleteAccountingVoucher(voucherType: VoucherType, id: string) {
  await requirePermission(voucherType, "delete");
  const supabase = await createClient();
  // Definer function removes the draft voucher header, its approvals and its
  // journal entry (+ lines); it refuses anything already posted.
  const { error } = await supabase
    .schema("accounting")
    .rpc("fn_delete_draft_voucher", { p_voucher_type: voucherType, p_id: id });
  if (error) return { error: error.message };

  revalidatePath(`/accounting/vouchers/${voucherType}`);
  return { success: true };
}

// Admin-only delete of a POSTED accounting voucher: physically removes the
// voucher, its lines and its journal entry (and any reversal that pointed at it)
// rather than leaving a reversed document behind.
export async function deletePostedVoucher(voucherType: VoucherType, id: string) {
  if (!(await isCurrentUserAdmin())) {
    return { error: "Only administrators can delete posted vouchers." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .rpc("fn_admin_delete_posted_voucher", { p_voucher_type: voucherType, p_id: id });
  if (error) return { error: error.message };

  revalidatePath(`/accounting/vouchers/${voucherType}`);
  revalidatePath(`/accounting/vouchers/${voucherType}/${id}`);
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  return { success: true };
}

// Duplicate an accounting voucher as a fresh draft dated today, reusing the
// per-type create action so every business rule (balanced entry, permissions,
// numbering) is enforced. Cheque Return is intentionally excluded — it reverses
// a specific pending PDC and flips that cheque's status, so it can't be copied.
export async function copyAccountingVoucher(voucherType: VoucherType, id: string) {
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const acc = supabase.schema("accounting");
  const today = new Date().toISOString().slice(0, 10);

  switch (voucherType) {
    case "receipt_voucher": {
      const { data: v } = await acc
        .from("receipt_vouchers")
        .select("due_date, debit_account_id, cost_center_id, currency_id, exchange_rate, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: rlines } = await acc
        .from("receipt_voucher_lines")
        .select("account_id, amount, rent_month, remarks")
        .eq("voucher_id", id)
        .order("line_no");
      return createReceiptVoucher({
        receiptDate: today,
        debitAccountId: v.debit_account_id ?? "",
        costCenterId: v.cost_center_id ?? "",
        currencyId: v.currency_id,
        exchangeRate: v.exchange_rate,
        narration: v.narration ?? "",
        lines: (rlines ?? []).map((l) => ({
          accountId: l.account_id,
          amount: l.amount,
          rentMonth: l.rent_month ?? "",
          remarks: l.remarks ?? "",
          allocations: [],
        })),
      }, { autoPostIfAdmin: false });
    }
    case "payment_voucher": {
      const { data: v } = await acc
        .from("payment_vouchers")
        .select("credit_account_id, cost_center_id, currency_id, exchange_rate, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: plines } = await acc
        .from("payment_voucher_lines")
        .select("account_id, amount, remarks")
        .eq("voucher_id", id)
        .order("line_no");
      return createPaymentVoucher({
        paymentDate: today,
        creditAccountId: v.credit_account_id ?? "",
        costCenterId: v.cost_center_id ?? "",
        currencyId: v.currency_id,
        exchangeRate: v.exchange_rate,
        narration: v.narration ?? "",
        lines: (plines ?? []).map((l) => ({
          accountId: l.account_id,
          amount: l.amount,
          remarks: l.remarks ?? "",
          allocations: [],
        })),
      }, { autoPostIfAdmin: false });
    }
    case "pdc_payment_voucher": {
      const { data: v } = await acc
        .from("pdc_payment_vouchers")
        .select("payee, credit_account_id, cost_center_id, currency_id, exchange_rate, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: plines } = await acc
        .from("pdc_payment_voucher_lines")
        .select("account_id, cheque_no, cheque_date, due_date, amount, rent_month, remarks")
        .eq("voucher_id", id)
        .order("line_no");
      return createPdcPaymentVoucher({
        voucherDate: today,
        payee: v.payee,
        creditAccountId: v.credit_account_id ?? "",
        costCenterId: v.cost_center_id ?? "",
        currencyId: v.currency_id,
        exchangeRate: v.exchange_rate,
        narration: v.narration ?? "",
        lines: (plines ?? []).map((l) => ({
          accountId: l.account_id,
          chequeNo: l.cheque_no,
          chequeDate: l.cheque_date,
          dueDate: l.due_date ?? "",
          amount: l.amount,
          rentMonth: l.rent_month ?? "",
          remarks: l.remarks ?? "",
        })),
      }, { autoPostIfAdmin: false });
    }
    case "pdc_receipt_voucher": {
      const { data: v } = await acc
        .from("pdc_receipt_vouchers")
        .select("payer, debit_account_id, cost_center_id, currency_id, exchange_rate, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: plines } = await acc
        .from("pdc_receipt_voucher_lines")
        .select("account_id, cheque_no, cheque_date, due_date, amount, rent_month, remarks")
        .eq("voucher_id", id)
        .order("line_no");
      return createPdcReceiptVoucher({
        voucherDate: today,
        payer: v.payer,
        debitAccountId: v.debit_account_id,
        costCenterId: v.cost_center_id ?? "",
        currencyId: v.currency_id,
        exchangeRate: v.exchange_rate,
        narration: v.narration ?? "",
        lines: (plines ?? []).map((l) => ({
          accountId: l.account_id,
          chequeNo: l.cheque_no,
          chequeDate: l.cheque_date,
          dueDate: l.due_date ?? "",
          amount: l.amount,
          rentMonth: l.rent_month ?? "",
          remarks: l.remarks ?? "",
          allocations: [],
        })),
      }, { autoPostIfAdmin: false });
    }
    case "journal_voucher": {
      const { data: v } = await acc
        .from("journal_vouchers")
        .select("journal_entry_id, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: je } = await acc
        .from("journal_entries")
        .select("currency_id, exchange_rate")
        .eq("id", v.journal_entry_id)
        .single();
      if (!je) return { error: "Voucher not found" };
      const { data: journalLines } = await acc
        .from("journal_voucher_lines")
        .select("cost_center_id, debit_account_id, credit_account_id, amount")
        .eq("voucher_id", id)
        .order("line_no");
      return createJournalVoucher({
        entryDate: today,
        currencyId: je.currency_id,
        exchangeRate: je.exchange_rate ?? 1,
        narration: v.narration ?? "",
        lines: (journalLines ?? []).map((l) => ({
          costCenterId: l.cost_center_id ?? "",
          debitAccountId: l.debit_account_id,
          creditAccountId: l.credit_account_id,
          amount: l.amount,
        })),
      }, { autoPostIfAdmin: false });
    }
    case "jv_maintenance_voucher": {
      const { data: v } = await acc
        .from("jv_maintenance_vouchers")
        .select("journal_entry_id, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: je } = await acc
        .from("journal_entries")
        .select("currency_id, exchange_rate")
        .eq("id", v.journal_entry_id)
        .single();
      if (!je) return { error: "Voucher not found" };
      const { data: jvLines } = await acc
        .from("jv_maintenance_voucher_lines")
        .select("cost_center_id, debit_account_id, credit_account_id, amount, period_from, period_till, remarks")
        .eq("voucher_id", id)
        .order("line_no");
      return createJvMaintenanceVoucher({
        entryDate: today,
        currencyId: je.currency_id,
        exchangeRate: je.exchange_rate ?? 1,
        narration: v.narration ?? "",
        lines: (jvLines ?? []).map((l) => ({
          costCenterId: l.cost_center_id ?? "",
          debitAccountId: l.debit_account_id,
          creditAccountId: l.credit_account_id,
          amount: l.amount,
          periodFrom: l.period_from ?? "",
          periodTill: l.period_till ?? "",
          remarks: l.remarks ?? "",
        })),
      }, { autoPostIfAdmin: false });
    }
    case "opening_balance_voucher": {
      const { data: v } = await acc
        .from("opening_balance_vouchers")
        .select("contra_account_id, cost_center_id, currency_id, exchange_rate, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: olines } = await acc
        .from("opening_balance_voucher_lines")
        .select("account_id, debit, credit, remarks")
        .eq("voucher_id", id)
        .order("line_no");
      return createOpeningBalanceVoucher({
        asOfDate: today,
        contraAccountId: v.contra_account_id ?? "",
        costCenterId: v.cost_center_id ?? "",
        currencyId: v.currency_id,
        exchangeRate: v.exchange_rate,
        narration: v.narration ?? "",
        lines: (olines ?? []).map((l) => ({
          accountId: l.account_id,
          debit: l.debit,
          credit: l.credit,
          remarks: l.remarks ?? "",
        })),
      }, { autoPostIfAdmin: false });
    }
    default:
      return { error: "Copy isn't available for this voucher type." };
  }
}

// Posting an approved voucher, per type — the approval itself posts it, so the
// approver never has to come back and press "Post".
const POST_ACTIONS: Partial<
  Record<VoucherType, (id: string, journalEntryId: string) => Promise<unknown>>
> = {
  receipt_voucher: postReceiptVoucher,
  payment_voucher: postPaymentVoucher,
  pdc_payment_voucher: postPdcPaymentVoucher,
  pdc_receipt_voucher: postPdcReceiptVoucher,
  cheque_return_voucher: postChequeReturnVoucher,
  journal_voucher: postJournalVoucher,
  jv_maintenance_voucher: postJvMaintenanceVoucher,
  opening_balance_voucher: postOpeningBalanceVoucher,
  multi_currency_journal: postMultiCurrencyJournal,
};

export async function actOnVoucher(
  voucherType: VoucherType,
  voucherApprovalId: string,
  voucherId: string,
  journalEntryId: string,
  action: "approve" | "reject" | "send_back",
  comment?: string,
) {
  await requirePermission(voucherType, action === "approve" ? "approve" : action === "reject" ? "reject" : "edit");

  const result = await actOnApproval({ voucherApprovalId, journalEntryId, action, comment });
  if ("error" in result) return { error: result.error };

  // Only the FINAL approval posts: a multi-level workflow comes back as
  // "pending" until the last approver signs it off. Best-effort, so an approver
  // without the post permission (or a voucher the posting trigger rejects) still
  // ends up approved with the manual Post button as the fallback.
  const status = (result.approval as { status?: string } | null)?.status;
  if (action === "approve" && status === "approved") {
    try {
      await POST_ACTIONS[voucherType]?.(voucherId, journalEntryId);
    } catch {
      // Left approved; the detail screen still offers Post.
    }
  }

  return { success: true };
}
