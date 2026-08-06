import { notFound, redirect } from "next/navigation";

import { JournalVoucherForm } from "@/components/vouchers/forms/journal-voucher-form";
import { JvMaintenanceVoucherForm } from "@/components/vouchers/forms/jv-maintenance-voucher-form";
import { OpeningBalanceVoucherForm } from "@/components/vouchers/forms/opening-balance-voucher-form";
import { PaymentVoucherForm } from "@/components/vouchers/forms/payment-voucher-form";
import { PdcPaymentVoucherForm } from "@/components/vouchers/forms/pdc-payment-voucher-form";
import { PdcReceiptVoucherForm } from "@/components/vouchers/forms/pdc-receipt-voucher-form";
import { ReceiptVoucherForm } from "@/components/vouchers/forms/receipt-voucher-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { isPhase5VoucherType, VOUCHER_TYPE_LABELS } from "@/lib/vouchers/meta";
import type { JournalEntryStatus } from "@/types/database.types";

// Voucher types whose draft can be re-opened in its form, mapped to their header
// table. All of these are a single journal entry (two-line or a balanced
// multi-line grid).
const EDITABLE_TABLE = {
  receipt_voucher: "receipt_vouchers",
  payment_voucher: "payment_vouchers",
  pdc_payment_voucher: "pdc_payment_vouchers",
  pdc_receipt_voucher: "pdc_receipt_vouchers",
  opening_balance_voucher: "opening_balance_vouchers",
  journal_voucher: "journal_vouchers",
  jv_maintenance_voucher: "jv_maintenance_vouchers",
} as const;
type EditableVoucherType = keyof typeof EDITABLE_TABLE;

const MULTI_LINE_TYPES: readonly string[] = ["journal_voucher", "jv_maintenance_voucher"];

export default async function EditVoucherPage({
  params,
}: {
  params: Promise<{ voucherType: string; id: string }>;
}) {
  const { voucherType, id } = await params;
  if (!isPhase5VoucherType(voucherType)) notFound();

  const detailHref = `/accounting/vouchers/${voucherType}/${id}`;
  if (!(voucherType in EDITABLE_TABLE)) redirect(detailHref);
  const editableType = voucherType as EditableVoucherType;

  const canEdit = await hasPermission(voucherType, "edit");
  if (!canEdit) redirect(detailHref);

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: accounts }, { data: companyCurrencies }] = await Promise.all([
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name")
      .eq("company_id", companyId)
      .eq("is_group", false)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("account_code"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
  ]);

  const accountOptions = accounts ?? [];
  type RawCurrency = { currencies: { id: string; code: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  const table = EDITABLE_TABLE[editableType];
  const { data: voucher } = await supabase
    .schema("accounting")
    .from(table)
    .select("*, journal_entries:journal_entry_id(status, currency_id)")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!voucher) notFound();

  const jeEmbed = (voucher as unknown as {
    journal_entries: { status: JournalEntryStatus; currency_id: string } | null;
  }).journal_entries;
  const status = jeEmbed?.status ?? "draft";
  // A posted (or in-approval) voucher is part of the ledger — send the user back.
  if (status !== "draft") redirect(detailHref);

  const v = voucher as unknown as Record<string, unknown>;

  // Multi-line vouchers (Journal / JV Maintenance) rebuild their grid from the
  // journal entry's lines and take the currency from the entry header.
  const isMultiLine = MULTI_LINE_TYPES.includes(voucherType);
  let lineValues: { accountId: string; costCenterId: string; debit: number; credit: number; description: string }[] =
    [];
  if (isMultiLine) {
    const { data: lines } = await supabase
      .schema("accounting")
      .from("journal_entry_lines")
      .select("account_id, cost_center_id, debit_amount, credit_amount, description")
      .eq("journal_entry_id", v.journal_entry_id as string)
      .order("line_no");
    lineValues = (lines ?? []).map((l) => ({
      accountId: l.account_id,
      costCenterId: l.cost_center_id ?? "",
      debit: l.debit_amount,
      credit: l.credit_amount,
      description: l.description ?? "",
    }));
  }

  let journalVouchers: { id: string; voucherNo: string | null }[] = [];
  if (voucherType === "jv_maintenance_voucher") {
    const { data: jvs } = await supabase
      .schema("accounting")
      .from("journal_vouchers")
      .select("id, voucher_no")
      .eq("company_id", companyId)
      .not("voucher_no", "is", null)
      .order("created_at", { ascending: false });
    journalVouchers = (jvs ?? []).map((jv) => ({ id: jv.id, voucherNo: jv.voucher_no }));
  }

  const jeCurrency = jeEmbed?.currency_id ?? "";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Edit {VOUCHER_TYPE_LABELS[voucherType]}</h1>

      {voucherType === "receipt_voucher" && (
        <ReceiptVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          voucherId={id}
          initialValues={{
            receiptDate: v.receipt_date as string,
            receivedFrom: v.received_from as string,
            debitAccountId: v.debit_account_id as string,
            creditAccountId: v.credit_account_id as string,
            currencyId: v.currency_id as string,
            amount: v.amount as number,
            narration: (v.narration as string | null) ?? "",
          }}
        />
      )}
      {voucherType === "payment_voucher" && (
        <PaymentVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          voucherId={id}
          initialValues={{
            paymentDate: v.payment_date as string,
            paidTo: v.paid_to as string,
            debitAccountId: v.debit_account_id as string,
            creditAccountId: v.credit_account_id as string,
            currencyId: v.currency_id as string,
            amount: v.amount as number,
            narration: (v.narration as string | null) ?? "",
          }}
        />
      )}
      {voucherType === "pdc_payment_voucher" && (
        <PdcPaymentVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          voucherId={id}
          initialValues={{
            chequeDate: v.cheque_date as string,
            chequeNo: v.cheque_no as string,
            payee: v.payee as string,
            debitAccountId: v.debit_account_id as string,
            creditAccountId: v.credit_account_id as string,
            currencyId: v.currency_id as string,
            amount: v.amount as number,
            narration: (v.narration as string | null) ?? "",
          }}
        />
      )}
      {voucherType === "pdc_receipt_voucher" && (
        <PdcReceiptVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          voucherId={id}
          initialValues={{
            chequeDate: v.cheque_date as string,
            chequeNo: v.cheque_no as string,
            payer: v.payer as string,
            debitAccountId: v.debit_account_id as string,
            creditAccountId: v.credit_account_id as string,
            currencyId: v.currency_id as string,
            amount: v.amount as number,
            narration: (v.narration as string | null) ?? "",
          }}
        />
      )}
      {voucherType === "opening_balance_voucher" && (
        <OpeningBalanceVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          voucherId={id}
          initialValues={{
            asOfDate: v.as_of_date as string,
            accountId: v.account_id as string,
            contraAccountId: v.contra_account_id as string,
            currencyId: v.currency_id as string,
            debitAmount: v.debit_amount as number,
            creditAmount: v.credit_amount as number,
          }}
        />
      )}
      {voucherType === "journal_voucher" && (
        <JournalVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          voucherId={id}
          initialValues={{
            entryDate: v.entry_date as string,
            currencyId: jeCurrency,
            narration: v.narration as string,
            lines: lineValues,
          }}
        />
      )}
      {voucherType === "jv_maintenance_voucher" && (
        <JvMaintenanceVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          journalVouchers={journalVouchers}
          voucherId={id}
          initialValues={{
            entryDate: v.entry_date as string,
            currencyId: jeCurrency,
            originalJvId: v.original_jv_id as string,
            adjustmentReason: v.adjustment_reason as string,
            lines: lineValues,
          }}
        />
      )}
    </div>
  );
}
