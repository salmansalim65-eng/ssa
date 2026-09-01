import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { JournalVoucherForm } from "@/components/vouchers/forms/journal-voucher-form";
import { JvMaintenanceVoucherForm } from "@/components/vouchers/forms/jv-maintenance-voucher-form";
import { MultiCurrencyJournalForm } from "@/components/vouchers/forms/multi-currency-journal-form";
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
  multi_currency_journal: "multi_currency_journal_vouchers",
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
  // Exceptions stay editable after posting: opening balances (corrections) and
  // receipt vouchers (the update action reverses & re-posts on save). For those,
  // only draft and posted are editable — never a pending/rejected voucher.
  const editableWhenPosted =
    voucherType === "opening_balance_voucher" || voucherType === "receipt_voucher";
  const editable = status === "draft" || (status === "posted" && editableWhenPosted);
  if (!editable) redirect(detailHref);

  const v = voucher as unknown as Record<string, unknown>;

  // Multi-line vouchers (Journal / JV Maintenance) rebuild their grid from the
  // journal entry's lines and take the currency from the entry header.
  const isMultiLine = MULTI_LINE_TYPES.includes(voucherType);
  const isJvMaintenance = voucherType === "jv_maintenance_voucher";
  const isMultiCurrencyJournal = voucherType === "multi_currency_journal";
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

  // The Multi-Currency Journal has no single voucher currency — each journal
  // entry line carries its own. Rebuild the raw Dr/Cr grid straight from
  // journal_entry_lines (account + side + currency + rate + amount).
  let mcjLines: {
    costCenterId: string;
    accountId: string;
    side: "debit" | "credit";
    currencyId: string;
    exchangeRate: number;
    amount: number;
  }[] = [];
  if (isMultiCurrencyJournal && jeEmbed) {
    const { data: lines } = await supabase
      .schema("accounting")
      .from("journal_entry_lines")
      .select("account_id, cost_center_id, debit_amount, credit_amount, currency_id, exchange_rate")
      .eq("journal_entry_id", (voucher as unknown as { journal_entry_id: string }).journal_entry_id)
      .order("line_no");
    mcjLines = (lines ?? []).map((l) => {
      const isDebit = Number(l.debit_amount) > 0;
      return {
        costCenterId: (l.cost_center_id as string | null) ?? "",
        accountId: l.account_id as string,
        side: isDebit ? ("debit" as const) : ("credit" as const),
        currencyId: l.currency_id as string,
        exchangeRate: Number(l.exchange_rate) || 1,
        amount: Number(isDebit ? l.debit_amount : l.credit_amount) || 0,
      };
    });
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
  type DocAllocation = { invoiceId: string; source: "rental" | "jv"; country: "UAE" | "PK"; amount: number };
  let docLines: {
    accountId: string;
    amount: number;
    rentMonth: string;
    remarks: string;
    allocations?: DocAllocation[];
  }[] = [];
  let obLines: { accountId: string; debit: number; credit: number; remarks: string }[] = [];
  if (isHeaderDoc || isOpeningBalance || isMultiLine || isJvMaintenance || isMultiCurrencyJournal) {
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
      .select("id, account_id, amount, rent_month, remarks")
      .eq("voucher_id", id)
      .order("line_no");
    const lineIds = (dlines ?? []).map((l) => l.id as string);
    docLines = (dlines ?? []).map((l) => ({
      accountId: l.account_id,
      amount: l.amount,
      rentMonth: l.rent_month ?? "",
      remarks: l.remarks ?? "",
      allocations: [],
    }));
    // Round-trip existing bill adjustments (receipt & payment), keyed by line id.
    const byLine = new Map<string, DocAllocation[]>();
    const pushAlloc = (key: string, a: DocAllocation) => {
      const list = byLine.get(key) ?? [];
      list.push(a);
      byLine.set(key, list);
    };
    if (voucherType === "receipt_voucher") {
      const { data: allocs } = await supabase
        .schema("rental")
        .from("receipt_invoice_allocations")
        .select("receipt_line_id, country, uae_invoice_id, pk_invoice_id, amount")
        .eq("receipt_voucher_id", id);
      for (const a of allocs ?? []) {
        const key = a.receipt_line_id as string | null;
        const invoiceId = (a.uae_invoice_id ?? a.pk_invoice_id) as string | null;
        if (!key || !invoiceId) continue;
        pushAlloc(key, { invoiceId, source: "rental", country: a.country as "UAE" | "PK", amount: Number(a.amount) });
      }
    } else if (voucherType === "payment_voucher") {
      const { data: allocs } = await supabase
        .schema("rental")
        .from("payment_invoice_expenses")
        .select("payment_line_id, country, uae_invoice_id, pk_invoice_id, amount")
        .eq("payment_voucher_id", id);
      for (const a of allocs ?? []) {
        const key = a.payment_line_id as string | null;
        const invoiceId = (a.uae_invoice_id ?? a.pk_invoice_id) as string | null;
        if (!key || !invoiceId) continue;
        pushAlloc(key, { invoiceId, source: "rental", country: a.country as "UAE" | "PK", amount: Number(a.amount) });
      }
    } else if (voucherType === "pdc_receipt_voucher") {
      const { data: allocs } = await supabase
        .schema("rental")
        .from("receipt_invoice_allocations")
        .select("pdc_receipt_line_id, country, uae_invoice_id, pk_invoice_id, amount")
        .eq("pdc_receipt_voucher_id", id);
      for (const a of allocs ?? []) {
        const key = a.pdc_receipt_line_id as string | null;
        const invoiceId = (a.uae_invoice_id ?? a.pk_invoice_id) as string | null;
        if (!key || !invoiceId) continue;
        pushAlloc(key, { invoiceId, source: "rental", country: a.country as "UAE" | "PK", amount: Number(a.amount) });
      }
    }
    // JV open-item settlements (receipt & payment), keyed by their voucher line.
    if (voucherType === "receipt_voucher" || voucherType === "payment_voucher") {
      const lineCol = voucherType === "receipt_voucher" ? "receipt_line_id" : "payment_line_id";
      const voucherCol = voucherType === "receipt_voucher" ? "receipt_voucher_id" : "payment_voucher_id";
      const { data: settles } = await supabase
        .schema("accounting")
        .from("jv_open_item_settlements")
        .select(`journal_line_id, ${lineCol}, amount`)
        .eq(voucherCol, id);
      for (const s of settles ?? []) {
        const key = (s as Record<string, unknown>)[lineCol] as string | null;
        const journalLineId = s.journal_line_id as string | null;
        if (!key || !journalLineId) continue;
        pushAlloc(key, { invoiceId: journalLineId, source: "jv", country: "PK", amount: Number(s.amount) });
      }
    }
    if (byLine.size) {
      docLines = docLines.map((dl, i) => ({ ...dl, allocations: byLine.get(lineIds[i]) ?? [] }));
    }
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

  // Outstanding rental bills a receipt/payment line can be adjusted against.
  let outstandingBills: {
    id: string;
    source?: "rental" | "jv";
    country: "UAE" | "PK";
    accountId: string | null;
    reference: string;
    dueDate: string | null;
    billAmount: number;
  }[] = [];
  if (
    voucherType === "receipt_voucher" ||
    voucherType === "payment_voucher" ||
    voucherType === "pdc_receipt_voucher"
  ) {
    const { data: inv } = await supabase
      .schema("reporting")
      .from("v_outstanding_rent")
      .select("invoice_id, country, tenant_account_id, voucher_no, tenant_name, asset_name, due_date, net_outstanding")
      .eq("company_id", companyId)
      .gt("net_outstanding", 0)
      .order("due_date");
    outstandingBills = (inv ?? []).map((r) => ({
      id: r.invoice_id as string,
      source: "rental" as const,
      country: r.country as "UAE" | "PK",
      accountId: (r.tenant_account_id as string | null) ?? null,
      reference: [r.voucher_no ?? "Draft", r.tenant_name, r.asset_name].filter(Boolean).join(" · "),
      dueDate: (r.due_date as string | null) ?? null,
      billAmount: Number(r.net_outstanding),
    }));
  }

  // Open Journal Voucher ledger items on a party account (receipt → debit side,
  // payment → credit side). The already-settled part of THIS voucher is added
  // back below so the amount stays editable.
  if (voucherType === "receipt_voucher" || voucherType === "payment_voucher") {
    const side = voucherType === "receipt_voucher" ? "debit" : "credit";
    const { data: jv } = await supabase
      .schema("accounting")
      .from("v_open_jv_items")
      .select("journal_line_id, account_id, voucher_no, entry_date, narration, remaining")
      .eq("company_id", companyId)
      .eq("side", side)
      .order("entry_date");
    const settleCol = voucherType === "receipt_voucher" ? "receipt_voucher_id" : "payment_voucher_id";
    const { data: mySettles } = await supabase
      .schema("accounting")
      .from("jv_open_item_settlements")
      .select("journal_line_id, amount")
      .eq(settleCol, id);
    const backByLine = new Map<string, number>();
    for (const s of mySettles ?? []) {
      const key = s.journal_line_id as string;
      backByLine.set(key, (backByLine.get(key) ?? 0) + Number(s.amount));
    }
    const jvBills = (jv ?? [])
      .map((r) => {
        const lineId = r.journal_line_id as string;
        const billAmount = Number(r.remaining) + (backByLine.get(lineId) ?? 0);
        return {
          id: lineId,
          source: "jv" as const,
          country: "PK" as const,
          accountId: (r.account_id as string | null) ?? null,
          reference: ["JV", r.voucher_no ?? "Draft", r.narration].filter(Boolean).join(" · "),
          dueDate: (r.entry_date as string | null) ?? null,
          billAmount,
        };
      })
      .filter((b) => b.billAmount > 0);
    outstandingBills = [...outstandingBills, ...jvBills];
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
          outstandingBills={outstandingBills}
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
          outstandingBills={outstandingBills}
          voucherId={id}
          initialValues={{
            paymentDate: v.payment_date as string,
            creditAccountId: v.credit_account_id as string,
            costCenterId: (v.cost_center_id as string | null) ?? "",
            currencyId: v.currency_id as string,
            exchangeRate: v.exchange_rate as number,
            narration: (v.narration as string | null) ?? "",
            lines: docLines.length
              ? docLines.map((l) => ({
                  accountId: l.accountId,
                  amount: l.amount,
                  remarks: l.remarks,
                  allocations: l.allocations ?? [],
                }))
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
          outstandingBills={outstandingBills}
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
            lines: docLines.length
              ? docLines.map((l) => ({
                  accountId: l.accountId,
                  amount: l.amount,
                  rentMonth: l.rentMonth,
                  remarks: l.remarks,
                  allocations: l.allocations ?? [],
                }))
              : [{ accountId: "", amount: 0, rentMonth: "", remarks: "", allocations: [] }],
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
      {voucherType === "multi_currency_journal" && (
        <MultiCurrencyJournalForm
          accounts={accountOptions}
          currencies={docCurrencies}
          costCenters={docCostCenters}
          voucherId={id}
          initialValues={{
            entryDate: v.entry_date as string,
            narration: (v.narration as string | null) ?? "",
            lines: mcjLines.length
              ? mcjLines
              : [
                  { costCenterId: "", accountId: "", side: "debit", currencyId: "", exchangeRate: 1, amount: 0 },
                  { costCenterId: "", accountId: "", side: "credit", currencyId: "", exchangeRate: 1, amount: 0 },
                ],
          }}
        />
      )}
    </div>
  );
}
