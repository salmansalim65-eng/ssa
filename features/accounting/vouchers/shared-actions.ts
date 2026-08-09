"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { actOnApproval, getCurrentCompanyId, submitForApproval } from "@/lib/vouchers/engine";
import type { VoucherType } from "@/types/database.types";
import { createReceiptVoucher } from "./receipt/actions";
import { createPaymentVoucher } from "./payment/actions";
import { createPdcPaymentVoucher } from "./pdc-payment/actions";
import { createPdcReceiptVoucher } from "./pdc-receipt/actions";
import { createJournalVoucher } from "./journal/actions";
import { createJvMaintenanceVoucher } from "./jv-maintenance/actions";
import { createOpeningBalanceVoucher } from "./opening-balance/actions";

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

// Duplicate an accounting voucher as a fresh draft dated today, reusing the
// per-type create action so every business rule (balanced entry, permissions,
// numbering) is enforced. Cheque Return is intentionally excluded — it reverses
// a specific pending PDC and flips that cheque's status, so it can't be copied.
export async function copyAccountingVoucher(voucherType: VoucherType, id: string) {
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const acc = supabase.schema("accounting");
  const today = new Date().toISOString().slice(0, 10);

  // Rebuild the journal lines from the source entry (for the multi-line types).
  const loadLines = async (journalEntryId: string) => {
    const { data } = await acc
      .from("journal_entry_lines")
      .select("account_id, cost_center_id, debit_amount, credit_amount, reference, description")
      .eq("journal_entry_id", journalEntryId)
      .order("line_no");
    return (data ?? []).map((l) => ({
      accountId: l.account_id,
      costCenterId: l.cost_center_id ?? "",
      debit: l.debit_amount,
      credit: l.credit_amount,
      reference: l.reference ?? "",
      remarks: l.description ?? "",
    }));
  };

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
        dueDate: v.due_date ?? "",
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
        })),
      });
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
        })),
      });
    }
    case "pdc_payment_voucher": {
      const { data: v } = await acc
        .from("pdc_payment_vouchers")
        .select("due_date, cheque_no, payee, credit_account_id, cost_center_id, currency_id, exchange_rate, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: plines } = await acc
        .from("pdc_payment_voucher_lines")
        .select("account_id, amount, rent_month, remarks")
        .eq("voucher_id", id)
        .order("line_no");
      return createPdcPaymentVoucher({
        chequeDate: today,
        dueDate: v.due_date ?? "",
        chequeNo: v.cheque_no,
        payee: v.payee,
        creditAccountId: v.credit_account_id ?? "",
        costCenterId: v.cost_center_id ?? "",
        currencyId: v.currency_id,
        exchangeRate: v.exchange_rate,
        narration: v.narration ?? "",
        lines: (plines ?? []).map((l) => ({
          accountId: l.account_id,
          amount: l.amount,
          rentMonth: l.rent_month ?? "",
          remarks: l.remarks ?? "",
        })),
      });
    }
    case "pdc_receipt_voucher": {
      const { data: v } = await acc
        .from("pdc_receipt_vouchers")
        .select("due_date, cheque_no, payer, debit_account_id, cost_center_id, currency_id, exchange_rate, narration")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return { error: "Voucher not found" };
      const { data: plines } = await acc
        .from("pdc_receipt_voucher_lines")
        .select("account_id, amount, rent_month, remarks")
        .eq("voucher_id", id)
        .order("line_no");
      return createPdcReceiptVoucher({
        chequeDate: today,
        dueDate: v.due_date ?? "",
        chequeNo: v.cheque_no,
        payer: v.payer,
        debitAccountId: v.debit_account_id,
        costCenterId: v.cost_center_id ?? "",
        currencyId: v.currency_id,
        exchangeRate: v.exchange_rate,
        narration: v.narration ?? "",
        lines: (plines ?? []).map((l) => ({
          accountId: l.account_id,
          amount: l.amount,
          rentMonth: l.rent_month ?? "",
          remarks: l.remarks ?? "",
        })),
      });
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
      return createJournalVoucher({
        entryDate: today,
        currencyId: je.currency_id,
        exchangeRate: je.exchange_rate ?? 1,
        narration: v.narration ?? "",
        lines: await loadLines(v.journal_entry_id),
      });
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
      return createJvMaintenanceVoucher({
        entryDate: today,
        currencyId: je.currency_id,
        exchangeRate: je.exchange_rate ?? 1,
        narration: v.narration ?? "",
        lines: await loadLines(v.journal_entry_id),
      });
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
      });
    }
    default:
      return { error: "Copy isn't available for this voucher type." };
  }
}

export async function actOnVoucher(
  voucherType: VoucherType,
  voucherApprovalId: string,
  journalEntryId: string,
  action: "approve" | "reject" | "send_back",
  comment?: string,
) {
  await requirePermission(voucherType, action === "approve" ? "approve" : action === "reject" ? "reject" : "edit");

  const result = await actOnApproval({ voucherApprovalId, journalEntryId, action, comment });
  if ("error" in result) return { error: result.error };

  return { success: true };
}
