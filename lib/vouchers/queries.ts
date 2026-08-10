import "server-only";

import { createClient } from "@/lib/supabase/server";
import { formatDate, formatRate } from "@/lib/format";
import type { JournalEntryStatus } from "@/types/database.types";
import type { Phase5VoucherType } from "./meta";

export interface VoucherListRow {
  id: string;
  voucherNo: string | null;
  date: string;
  party: string;
  amount: number;
  /** Symbol of the voucher's transaction currency, prefixed to the amount when
   * present (e.g. "Rs", "SR"). Null falls back to a bare number. */
  currencySymbol?: string | null;
  /** Amount converted to the company base currency (amount × exchange_rate),
   * shown beneath the transaction amount when the two differ. */
  baseAmount?: number | null;
  journalEntryId: string;
  status: JournalEntryStatus;
}

export interface VoucherDetailField {
  label: string;
  value: string;
}

export interface VoucherDetail {
  id: string;
  voucherNo: string | null;
  date: string;
  narration: string | null;
  journalEntryId: string;
  status: JournalEntryStatus;
  currencyCode: string;
  currencySymbol: string | null;
  /** Conversion factor from the transaction currency to the base currency
   * (base = amount × exchangeRate); 1 when the voucher is already in base. */
  exchangeRate: number;
  fields: VoucherDetailField[];
  lines: {
    accountCode: string;
    accountName: string;
    costCenterName: string | null;
    debit: number;
    credit: number;
    description: string | null;
    reference?: string | null;
  }[];
}

export async function getVoucherListRows(
  companyId: string,
  voucherType: Phase5VoucherType,
): Promise<VoucherListRow[]> {
  const supabase = await createClient();

  switch (voucherType) {
    case "receipt_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("receipt_vouchers")
        .select("id, voucher_no, receipt_date, total_amount, exchange_rate, journal_entry_id, journal_entries:journal_entry_id(status), currencies:currency_id(symbol), debit:debit_account_id(account_name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.receipt_date,
        party: (r.debit as unknown as { account_name: string } | null)?.account_name ?? "—",
        amount: r.total_amount,
        currencySymbol: (r.currencies as unknown as { symbol: string } | null)?.symbol ?? null,
        baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "payment_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("payment_vouchers")
        .select("id, voucher_no, payment_date, total_amount, exchange_rate, journal_entry_id, journal_entries:journal_entry_id(status), currencies:currency_id(symbol), credit:credit_account_id(account_name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.payment_date,
        party: (r.credit as unknown as { account_name: string } | null)?.account_name ?? "—",
        amount: r.total_amount,
        currencySymbol: (r.currencies as unknown as { symbol: string } | null)?.symbol ?? null,
        baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "pdc_payment_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("pdc_payment_vouchers")
        .select("id, voucher_no, cheque_date, payee, total_amount, exchange_rate, journal_entry_id, journal_entries:journal_entry_id(status), currencies:currency_id(symbol)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.cheque_date,
        party: r.payee,
        amount: r.total_amount,
        currencySymbol: (r.currencies as unknown as { symbol: string } | null)?.symbol ?? null,
        baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "pdc_receipt_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("pdc_receipt_vouchers")
        .select("id, voucher_no, cheque_date, payer, total_amount, exchange_rate, journal_entry_id, journal_entries:journal_entry_id(status), currencies:currency_id(symbol)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.cheque_date,
        party: r.payer,
        amount: r.total_amount,
        currencySymbol: (r.currencies as unknown as { symbol: string } | null)?.symbol ?? null,
        baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "cheque_return_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("cheque_return_vouchers")
        .select("id, voucher_no, return_date, return_reason, penalty_amount, exchange_rate, journal_entry_id, journal_entries:journal_entry_id(status), currencies:currency_id(symbol)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.return_date,
        party: r.return_reason,
        amount: r.penalty_amount,
        currencySymbol: (r.currencies as unknown as { symbol: string } | null)?.symbol ?? null,
        baseAmount: Number(r.penalty_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "journal_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("journal_vouchers")
        .select("id, voucher_no, entry_date, narration, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.entry_date,
        party: r.narration,
        amount: 0,
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "jv_maintenance_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("jv_maintenance_vouchers")
        .select("id, voucher_no, entry_date, narration, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.entry_date,
        party: r.narration,
        amount: 0,
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "opening_balance_voucher": {
      // Show the property/asset account(s) the opening balance was booked to —
      // not the CAPITAL contra — and the amount in its own transaction currency.
      const { data } = await supabase
        .schema("accounting")
        .from("opening_balance_vouchers")
        .select(
          "id, voucher_no, as_of_date, total_amount, exchange_rate, journal_entry_id, journal_entries:journal_entry_id(status), currencies:currency_id(symbol), lines:opening_balance_voucher_lines(debit, credit, account:account_id(account_name))",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => {
        const lines =
          (r.lines as unknown as { debit: number; credit: number; account: { account_name: string } | null }[]) ?? [];
        // The debit side holds the asset; fall back to any line if none is a debit.
        const source = lines.filter((l) => Number(l.debit) > 0);
        const names = [...new Set((source.length ? source : lines).map((l) => l.account?.account_name).filter(Boolean))];
        const party = names.length === 1 ? (names[0] as string) : names.length > 1 ? `Split (${names.length})` : "—";
        return {
          id: r.id,
          voucherNo: r.voucher_no,
          date: r.as_of_date,
          party,
          amount: r.total_amount,
          currencySymbol: (r.currencies as unknown as { symbol: string } | null)?.symbol ?? null,
          baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
          journalEntryId: r.journal_entry_id,
          status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
        };
      });
    }
  }
}

async function getJournalEntryWithLines(journalEntryId: string) {
  const supabase = await createClient();

  // The header and the lines both key off journalEntryId, so fetch them
  // together rather than one after the other.
  const [{ data: je }, { data: lines }] = await Promise.all([
    supabase
      .schema("accounting")
      .from("journal_entries")
      .select("id, status, narration, currency_id, exchange_rate")
      .eq("id", journalEntryId)
      .single(),
    supabase
      .schema("accounting")
      .from("journal_entry_lines")
      .select(
        "debit_amount, credit_amount, description, reference, chart_of_accounts:account_id(account_code, account_name), cost_centers:cost_center_id(name)",
      )
      .eq("journal_entry_id", journalEntryId)
      .order("line_no"),
  ]);

  const { data: currency } = je?.currency_id
    ? await supabase.schema("core").from("currencies").select("code, symbol").eq("id", je.currency_id).maybeSingle()
    : { data: null };
  const cur = currency as { code: string; symbol: string } | null;

  return {
    status: (je?.status ?? "draft") as JournalEntryStatus,
    narration: je?.narration ?? null,
    exchangeRate: (je?.exchange_rate as number | null) ?? 1,
    currencyCode: cur?.code ?? "",
    currencySymbol: cur?.symbol ?? null,
    lines: (lines ?? []).map((l) => {
      const account = l.chart_of_accounts as unknown as { account_code: string; account_name: string } | null;
      const costCenter = l.cost_centers as unknown as { name: string } | null;
      return {
        accountCode: account?.account_code ?? "",
        accountName: account?.account_name ?? "",
        costCenterName: costCenter?.name ?? null,
        debit: l.debit_amount,
        credit: l.credit_amount,
        description: l.description,
        reference: (l.reference as string | null) ?? null,
      };
    }),
  };
}

export async function getVoucherDetail(
  companyId: string,
  voucherType: Phase5VoucherType,
  id: string,
): Promise<VoucherDetail | null> {
  const supabase = await createClient();

  switch (voucherType) {
    case "receipt_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("receipt_vouchers")
        .select("*, debit:debit_account_id(account_code, account_name), cost_center:cost_center_id(name)")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      const debit = v.debit as unknown as { account_code: string; account_name: string } | null;
      const costCenter = v.cost_center as unknown as { name: string } | null;
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.receipt_date,
        narration: v.narration,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          { label: "Debit account (Cash/Bank)", value: debit ? `${debit.account_code} — ${debit.account_name}` : "—" },
          { label: "Due date", value: v.due_date ?? "—" },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: formatRate(v.exchange_rate) },
          { label: "Total", value: v.total_amount.toLocaleString() },
        ],
        lines: je.lines,
      };
    }
    case "payment_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("payment_vouchers")
        .select("*, credit:credit_account_id(account_code, account_name), cost_center:cost_center_id(name)")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      const credit = v.credit as unknown as { account_code: string; account_name: string } | null;
      const costCenter = v.cost_center as unknown as { name: string } | null;
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.payment_date,
        narration: v.narration,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          { label: "Credit account (Cash/Bank)", value: credit ? `${credit.account_code} — ${credit.account_name}` : "—" },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: formatRate(v.exchange_rate) },
          { label: "Total", value: v.total_amount.toLocaleString() },
        ],
        lines: je.lines,
      };
    }
    case "pdc_payment_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("pdc_payment_vouchers")
        .select("*, credit:credit_account_id(account_code, account_name), cost_center:cost_center_id(name)")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      const credit = v.credit as unknown as { account_code: string; account_name: string } | null;
      const costCenter = v.cost_center as unknown as { name: string } | null;
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.cheque_date,
        narration: v.narration,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          { label: "Credit account (PDC liability)", value: credit ? `${credit.account_code} — ${credit.account_name}` : "—" },
          { label: "Payee", value: v.payee },
          { label: "Cheque number", value: v.cheque_no },
          { label: "Due date", value: v.due_date ?? "—" },
          { label: "Cheque status", value: v.pdc_status },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: formatRate(v.exchange_rate) },
          { label: "Total", value: v.total_amount.toLocaleString() },
        ],
        lines: je.lines,
      };
    }
    case "pdc_receipt_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("pdc_receipt_vouchers")
        .select("*, debit:debit_account_id(account_code, account_name), cost_center:cost_center_id(name)")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      const debit = v.debit as unknown as { account_code: string; account_name: string } | null;
      const costCenter = v.cost_center as unknown as { name: string } | null;
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.cheque_date,
        narration: v.narration,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          { label: "Debit account (PDC asset)", value: debit ? `${debit.account_code} — ${debit.account_name}` : "—" },
          { label: "Payer", value: v.payer },
          { label: "Cheque number", value: v.cheque_no },
          { label: "Due date", value: v.due_date ?? "—" },
          { label: "Cheque status", value: v.pdc_status },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: formatRate(v.exchange_rate) },
          { label: "Total", value: v.total_amount.toLocaleString() },
        ],
        lines: je.lines,
      };
    }
    case "cheque_return_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("cheque_return_vouchers")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.return_date,
        narration: v.return_reason,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          { label: "Original PDC type", value: v.original_pdc_type },
          { label: "Return reason", value: v.return_reason },
          { label: "Penalty amount", value: v.penalty_amount.toLocaleString() },
        ],
        lines: je.lines,
      };
    }
    case "journal_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("journal_vouchers")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.entry_date,
        narration: v.narration,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          { label: "Currency conv.", value: formatRate(je.exchangeRate) },
        ],
        lines: je.lines,
      };
    }
    case "jv_maintenance_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("jv_maintenance_vouchers")
        .select("*, period_from, period_till")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.entry_date,
        narration: v.narration,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          ...(v.period_from ? [{ label: "Period from", value: formatDate(v.period_from) }] : []),
          ...(v.period_till ? [{ label: "Period till", value: formatDate(v.period_till) }] : []),
          { label: "Currency conv.", value: formatRate(je.exchangeRate) },
        ],
        lines: je.lines,
      };
    }
    case "opening_balance_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("opening_balance_vouchers")
        .select("*, contra:contra_account_id(account_code, account_name), cost_center:cost_center_id(name)")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      const contra = v.contra as unknown as { account_code: string; account_name: string } | null;
      const costCenter = v.cost_center as unknown as { name: string } | null;
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.as_of_date,
        narration: v.narration,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          { label: "Contra account (Opening Balance Equity)", value: contra ? `${contra.account_code} — ${contra.account_name}` : "—" },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: formatRate(v.exchange_rate) },
          { label: "Total", value: v.total_amount.toLocaleString() },
        ],
        lines: je.lines,
      };
    }
  }
}
