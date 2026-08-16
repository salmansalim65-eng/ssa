import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { JournalVoucherForm } from "@/components/vouchers/forms/journal-voucher-form";
import { JvMaintenanceVoucherForm } from "@/components/vouchers/forms/jv-maintenance-voucher-form";
import { OpeningBalanceVoucherForm } from "@/components/vouchers/forms/opening-balance-voucher-form";
import { PaymentVoucherForm } from "@/components/vouchers/forms/payment-voucher-form";
import { PdcPaymentVoucherForm } from "@/components/vouchers/forms/pdc-payment-voucher-form";
import { PdcReceiptVoucherForm } from "@/components/vouchers/forms/pdc-receipt-voucher-form";
import { ReceiptVoucherForm } from "@/components/vouchers/forms/receipt-voucher-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
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

const MULTI_LINE_TYPES: readonly string[] = ["journal_voucher"];

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
  const companyId = await getCurrentCompanyId();

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

  const table = EDITABLE_TABLE[editableType];
  const { data: voucher } = await supabase
    .schema("accounting")
    .from(table)
    .select("*, journal_entries:journal_entry_id(status, currency_id, exchange_rate)")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!voucher) notFound();

  const jeEmbed = (voucher as unknown as {
    journal_entries: { status: JournalEntryStatus; currency_id: string; exchange_rate: number } | null;
  }).journal_entries;
  const status = jeEmbed?.status ?? "draft";
  // A posted (or in-approval) voucher is part of the ledger — send the user back.
  // Opening balances are the exception: they stay editable after posting so
  // opening figures can be corrected.
  const editableWhenPosted = voucherType === "opening_balance_voucher";
  if (status !== "draft" && !editableWhenPosted) redirect(detailHref);

  const v = voucher as unknown as Record<string, unknown>;

  // Multi-line vouchers (Journal / JV Maintenance) rebuild their grid from the
  // journal entry's lines and take the currency from the entry header.
  const isMultiLine = MULTI_LINE_TYPES.includes(voucherType);
  const isJvMaintenance = voucherType === "jv_maintenance_voucher";
  // The Journal Voucher keeps its own line grid (cost centre + debit account +
  // credit account + amount) in its dedicated line table; each row expands into
  // a balanced Dr/Cr pair of journal_entry_lines at post time.
  let journalLines: {
    costCenterId: string;
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
  }[] = [];
  if (isMultiLine) {
    const { data: lines } = await supabase
      .schema("accounting")
      .from("journal_voucher_lines")
      .select("cost_center_id, debit_account_id, credit_account_id, amount")
      .eq("voucher_id", id)
      .order("line_no");
    journalLines = (lines ?? []).map((l) => ({
      costCenterId: l.cost_center_id ?? "",
      debitAccountId: l.debit_account_id,
      creditAccountId: l.credit_account_id,
      amount: l.amount,
    }));
  }

  // JV Maintenance keeps its own line grid (one balanced Dr/Cr pair per row) in
  // its dedicated line table, with a per-row billing period and remarks.
  let jvMaintLines: {
    costCenterId: string;
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
    periodFrom: string;
    periodTill: string;
    remarks: string;
  }[] = [];
  if (isJvMaintenance) {
    const { data: lines } = await supabase
      .schema("accounting")
      .from("jv_maintenance_voucher_lines")
      .select("cost_center_id, debit_account_id, credit_account_id, amount, period_from, period_till, remarks")
      .eq("voucher_id", id)
      .order("line_no");
    jvMaintLines = (lines ?? []).map((l) => ({
      costCenterId: l.cost_center_id ?? "",
      debitAccountId: l.debit_account_id,
      creditAccountId: l.credit_account_id,
      amount: l.amount,
      periodFrom: l.period_from ?? "",
      periodTill: l.period_till ?? "",
      remarks: l.remarks ?? "",
    }));
  }

  const jeCurrency = jeEmbed?.currency_id ?? "";
  const jeExchangeRate = jeEmbed?.exchange_rate ?? 1;

  // The Receipt, Payment and PDC vouchers are header + line documents: load
  // their cost centres, conversion-rate-carrying currencies, and their own lines.
  const HEADER_DOC_LINES: Record<string, string> = {
    receipt_voucher: "receipt_voucher_lines",
    payment_voucher: "payment_voucher_lines",
    pdc_payment_voucher: "pdc_payment_voucher_lines",
    pdc_receipt_voucher: "pdc_receipt_voucher_lines",
  };
  const isHeaderDoc = voucherType in HEADER_DOC_LINES;
  const isOpeningBalance = voucherType === "opening_balance_voucher";
  let docCostCenters: { id: string; name: string }[] = [];
  let docCurrencies: { id: string; code: string; rate: number }[] = [];
  let docLines: { accountId: string; amount: number; rentMonth: string; remarks: string }[] = [];
  let obLines: { accountId: string; debit: number; credit: number; remarks: string }[] = [];
  if (isHeaderDoc || isOpeningBalance || isMultiLine || isJvMaintenance) {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: ccs }, rates] = await Promise.all([
      supabase
        .schema("accounting")
        .from("cost_centers")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name"),
      Promise.all(
        ((companyCurrencies as unknown as RawCurrency[]) ?? [])
          .filter((cc) => cc.currencies)
          .map(async (cc) => {
            const { data: rate } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
              p_company_id: companyId,
              p_currency_id: cc.currencies!.id,
              p_as_of_date: today,
            });
            return { id: cc.currencies!.id, code: cc.currencies!.code, rate: (rate as number | null) ?? 1 };
          }),
      ),
    ]);
    docCostCenters = ccs ?? [];
    docCurrencies = rates;
  }
  if (isHeaderDoc) {
    const { data: dlines } = await supabase
      .schema("accounting")
      .from(HEADER_DOC_LINES[voucherType])
      .select("account_id, amount, rent_month, remarks")
      .eq("voucher_id", id)
      .order("line_no");
    docLines = (dlines ?? []).map((l) => ({
      accountId: l.account_id,
      amount: l.amount,
      rentMonth: l.rent_month ?? "",
      remarks: l.remarks ?? "",
    }));
  }
  if (isOpeningBalance) {
    const { data: obl } = await supabase
      .schema("accounting")
      .from("opening_balance_voucher_lines")
      .select("account_id, debit, credit, remarks")
      .eq("voucher_id", id)
      .order("line_no");
    obLines = (obl ?? []).map((l) => ({
      accountId: l.account_id,
      debit: l.debit,
      credit: l.credit,
      remarks: l.remarks ?? "",
    }));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Vouchers"
        title={`Edit ${VOUCHER_TYPE_LABELS[voucherType]}`}
        description={
          editableWhenPosted
            ? "Update this opening balance voucher. Changes re-post to the ledger."
            : "Update this draft voucher. Posted vouchers can't be edited."
        }
        backHref={`/accounting/vouchers/${voucherType}`}
      />

      {voucherType === "receipt_voucher" && (
        <ReceiptVoucherForm
          accounts={accountOptions}
          currencies={docCurrencies}
          costCenters={docCostCenters}
          voucherId={id}
          initialValues={{
            receiptDate: v.receipt_date as string,
            debitAccountId: v.debit_account_id as string,
            costCenterId: (v.cost_center_id as string | null) ?? "",
            currencyId: v.currency_id as string,
            exchangeRate: v.exchange_rate as number,
            narration: (v.narration as string | null) ?? "",
            lines: docLines.length ? docLines : [{ accountId: "", amount: 0, rentMonth: "", remarks: "" }],
          }}
        />
      )}
      {voucherType === "payment_voucher" && (
        <PaymentVoucherForm
          accounts={accountOptions}
          currencies={docCurrencies}
          costCenters={docCostCenters}
          voucherId={id}
          initialValues={{
            paymentDate: v.payment_date as string,
            creditAccountId: v.credit_account_id as string,
            costCenterId: (v.cost_center_id as string | null) ?? "",
            currencyId: v.currency_id as string,
            exchangeRate: v.exchange_rate as number,
            narration: (v.narration as string | null) ?? "",
            lines: docLines.length
              ? docLines.map((l) => ({ accountId: l.accountId, amount: l.amount, remarks: l.remarks }))
              : [{ accountId: "", amount: 0, remarks: "" }],
          }}
        />
      )}
      {voucherType === "pdc_payment_voucher" && (
        <PdcPaymentVoucherForm
          accounts={accountOptions}
          currencies={docCurrencies}
          costCenters={docCostCenters}
          voucherId={id}
          initialValues={{
            chequeDate: v.cheque_date as string,
            dueDate: (v.due_date as string | null) ?? "",
            chequeNo: v.cheque_no as string,
            payee: v.payee as string,
            creditAccountId: v.credit_account_id as string,
            costCenterId: (v.cost_center_id as string | null) ?? "",
            currencyId: v.currency_id as string,
            exchangeRate: v.exchange_rate as number,
            narration: (v.narration as string | null) ?? "",
            lines: docLines.length ? docLines : [{ accountId: "", amount: 0, rentMonth: "", remarks: "" }],
          }}
        />
      )}
      {voucherType === "pdc_receipt_voucher" && (
        <PdcReceiptVoucherForm
          accounts={accountOptions}
          currencies={docCurrencies}
          costCenters={docCostCenters}
          voucherId={id}
          initialValues={{
            chequeDate: v.cheque_date as string,
            dueDate: (v.due_date as string | null) ?? "",
            chequeNo: v.cheque_no as string,
            payer: v.payer as string,
            debitAccountId: v.debit_account_id as string,
            costCenterId: (v.cost_center_id as string | null) ?? "",
            currencyId: v.currency_id as string,
            exchangeRate: v.exchange_rate as number,
            narration: (v.narration as string | null) ?? "",
            lines: docLines.length ? docLines : [{ accountId: "", amount: 0, rentMonth: "", remarks: "" }],
          }}
        />
      )}
      {voucherType === "opening_balance_voucher" && (
        <OpeningBalanceVoucherForm
          accounts={accountOptions}
          currencies={docCurrencies}
          costCenters={docCostCenters}
          voucherId={id}
          initialValues={{
            asOfDate: v.as_of_date as string,
            contraAccountId: v.contra_account_id as string,
            costCenterId: (v.cost_center_id as string | null) ?? "",
            currencyId: v.currency_id as string,
            exchangeRate: v.exchange_rate as number,
            narration: (v.narration as string | null) ?? "",
            lines: obLines.length ? obLines : [{ accountId: "", debit: 0, credit: 0, remarks: "" }],
          }}
        />
      )}
      {voucherType === "journal_voucher" && (
        <JournalVoucherForm
          accounts={accountOptions}
          currencies={docCurrencies}
          costCenters={docCostCenters}
          voucherId={id}
          initialValues={{
            entryDate: v.entry_date as string,
            currencyId: jeCurrency,
            exchangeRate: jeExchangeRate,
            narration: (v.narration as string | null) ?? "",
            lines: journalLines.length
              ? journalLines
              : [{ costCenterId: "", debitAccountId: "", creditAccountId: "", amount: 0 }],
          }}
        />
      )}
      {voucherType === "jv_maintenance_voucher" && (
        <JvMaintenanceVoucherForm
          accounts={accountOptions}
          currencies={docCurrencies}
          costCenters={docCostCenters}
          voucherId={id}
          initialValues={{
            entryDate: v.entry_date as string,
            currencyId: jeCurrency,
            exchangeRate: jeExchangeRate,
            narration: (v.narration as string | null) ?? "",
            lines: jvMaintLines.length
              ? jvMaintLines
              : [
                  {
                    costCenterId: "",
                    debitAccountId: "",
                    creditAccountId: "",
                    amount: 0,
                    periodFrom: "",
                    periodTill: "",
                    remarks: "",
                  },
                ],
          }}
        />
      )}
    </div>
  );
}
