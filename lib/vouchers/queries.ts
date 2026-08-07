import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import type { JournalEntryStatus } from "@/types/database.types";
import type { Phase5VoucherType } from "./meta";

export interface VoucherListRow {
  id: string;
  voucherNo: string | null;
  date: string;
  party: string;
  amount: number;
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
  fields: VoucherDetailField[];
  lines: {
    accountCode: string;
    accountName: string;
    costCenterName: string | null;
    debit: number;
    credit: number;
    description: string | null;
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
        .select("id, voucher_no, receipt_date, total_amount, journal_entry_id, journal_entries:journal_entry_id(status), debit:debit_account_id(account_name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.receipt_date,
        party: (r.debit as unknown as { account_name: string } | null)?.account_name ?? "—",
        amount: r.total_amount,
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "payment_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("payment_vouchers")
        .select("id, voucher_no, payment_date, total_amount, journal_entry_id, journal_entries:journal_entry_id(status), credit:credit_account_id(account_name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.payment_date,
        party: (r.credit as unknown as { account_name: string } | null)?.account_name ?? "—",
        amount: r.total_amount,
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "pdc_payment_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("pdc_payment_vouchers")
        .select("id, voucher_no, cheque_date, payee, total_amount, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.cheque_date,
        party: r.payee,
        amount: r.total_amount,
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "pdc_receipt_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("pdc_receipt_vouchers")
        .select("id, voucher_no, cheque_date, payer, total_amount, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.cheque_date,
        party: r.payer,
        amount: r.total_amount,
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "cheque_return_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("cheque_return_vouchers")
        .select("id, voucher_no, return_date, return_reason, penalty_amount, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.return_date,
        party: r.return_reason,
        amount: r.penalty_amount,
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
        .select("id, voucher_no, adjustment_reason, journal_entry_id, journal_entries:journal_entry_id(status, entry_date)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => {
        const je = r.journal_entries as unknown as { status: JournalEntryStatus; entry_date: string };
        return {
          id: r.id,
          voucherNo: r.voucher_no,
          date: je.entry_date,
          party: r.adjustment_reason,
          amount: 0,
          journalEntryId: r.journal_entry_id,
          status: je.status,
        };
      });
    }
    case "opening_balance_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("opening_balance_vouchers")
        .select(
          "id, voucher_no, as_of_date, debit_amount, credit_amount, journal_entry_id, journal_entries:journal_entry_id(status), accounts:account_id(account_name)",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.as_of_date,
        party: (r.accounts as unknown as { account_name: string } | null)?.account_name ?? "—",
        amount: r.debit_amount || r.credit_amount,
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
  }
}

async function getJournalEntryWithLines(journalEntryId: string) {
  const supabase = await createClient();

  const { data: je } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .select("id, status, narration, currency_id")
    .eq("id", journalEntryId)
    .single();

  const currenciesById = await fetchRefs<{ id: string; code: string }>(
    supabase,
    "core",
    "currencies",
    "code",
    [je?.currency_id],
  );

  const { data: lines } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .select(
      "debit_amount, credit_amount, description, chart_of_accounts:account_id(account_code, account_name), cost_centers:cost_center_id(name)",
    )
    .eq("journal_entry_id", journalEntryId)
    .order("line_no");

  return {
    status: (je?.status ?? "draft") as JournalEntryStatus,
    narration: je?.narration ?? null,
    currencyCode: (je?.currency_id ? currenciesById.get(je.currency_id)?.code : undefined) ?? "",
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
        fields: [
          { label: "Debit account (Cash/Bank)", value: debit ? `${debit.account_code} — ${debit.account_name}` : "—" },
          { label: "Due date", value: v.due_date ?? "—" },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: v.exchange_rate.toLocaleString() },
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
        fields: [
          { label: "Credit account (Cash/Bank)", value: credit ? `${credit.account_code} — ${credit.account_name}` : "—" },
          { label: "Due date", value: v.due_date ?? "—" },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: v.exchange_rate.toLocaleString() },
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
        fields: [
          { label: "Credit account (PDC liability)", value: credit ? `${credit.account_code} — ${credit.account_name}` : "—" },
          { label: "Payee", value: v.payee },
          { label: "Cheque number", value: v.cheque_no },
          { label: "Due date", value: v.due_date ?? "—" },
          { label: "Cheque status", value: v.pdc_status },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: v.exchange_rate.toLocaleString() },
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
        fields: [
          { label: "Debit account (PDC asset)", value: debit ? `${debit.account_code} — ${debit.account_name}` : "—" },
          { label: "Payer", value: v.payer },
          { label: "Cheque number", value: v.cheque_no },
          { label: "Due date", value: v.due_date ?? "—" },
          { label: "Cheque status", value: v.pdc_status },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: v.exchange_rate.toLocaleString() },
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
        fields: [],
        lines: je.lines,
      };
    }
    case "jv_maintenance_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("jv_maintenance_vouchers")
        .select("*, original:original_jv_id(voucher_no)")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      const original = v.original as unknown as { voucher_no: string | null } | null;
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: je.narration ?? "",
        narration: v.adjustment_reason,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        fields: [
          { label: "Original JV", value: original?.voucher_no ?? "—" },
          { label: "Adjustment reason", value: v.adjustment_reason },
        ],
        lines: je.lines,
      };
    }
    case "opening_balance_voucher": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("opening_balance_vouchers")
        .select("*, account:account_id(account_code, account_name), contra:contra_account_id(account_code, account_name)")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      const account = v.account as unknown as { account_code: string; account_name: string };
      const contra = v.contra as unknown as { account_code: string; account_name: string };
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.as_of_date,
        narration: null,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        currencyCode: je.currencyCode,
        fields: [
          { label: "Account", value: `${account.account_code} — ${account.account_name}` },
          { label: "Contra account", value: `${contra.account_code} — ${contra.account_name}` },
          { label: "Debit", value: v.debit_amount.toLocaleString() },
          { label: "Credit", value: v.credit_amount.toLocaleString() },
        ],
        lines: je.lines,
      };
    }
  }
}
