import "server-only";

import { createClient } from "@/lib/supabase/server";
import { formatAccountCode, formatDate, formatRate } from "@/lib/format";
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
    /** Per-line transaction currency + base amounts. Set for vouchers whose
     * lines can each be in a different currency (Multi-Currency Journal); the
     * debit/credit above are then in this currency and base is the converted
     * amount used for balancing. */
    currencyCode?: string | null;
    currencySymbol?: string | null;
    baseDebit?: number;
    baseCredit?: number;
  }[];
}

// Resolves the "party" for a header+lines voucher (Receipt / Payment) from its
// LINE accounts — the counter-party the money moved to/from — rather than the
// Cash/Bank account on the header. Returns a map of voucher_id → party label
// ("Split (n)" when a voucher has several distinct line accounts).
async function resolvePartyFromLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lineTable: "receipt_voucher_lines" | "payment_voucher_lines",
  voucherIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!voucherIds.length) return result;

  const { data: lines } = await supabase
    .schema("accounting")
    .from(lineTable)
    .select("voucher_id, account_id")
    .in("voucher_id", voucherIds);

  const accountIds = [...new Set((lines ?? []).map((l) => l.account_id as string))];
  const nameById = new Map<string, string>();
  if (accountIds.length) {
    const { data: accts } = await supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_name")
      .in("id", accountIds);
    for (const a of accts ?? []) nameById.set(a.id as string, a.account_name as string);
  }

  const namesByVoucher = new Map<string, Set<string>>();
  for (const l of lines ?? []) {
    const vid = l.voucher_id as string;
    const name = nameById.get(l.account_id as string);
    if (!name) continue;
    if (!namesByVoucher.has(vid)) namesByVoucher.set(vid, new Set());
    namesByVoucher.get(vid)!.add(name);
  }
  for (const [vid, names] of namesByVoucher) {
    const list = [...names];
    result.set(vid, list.length === 1 ? list[0] : `Split (${list.length})`);
  }
  return result;
}

export async function getVoucherListRows(
  companyId: string,
  voucherType: Phase5VoucherType,
): Promise<VoucherListRow[]> {
  const supabase = await createClient();

  // Currency symbols are looked up from a map rather than embedded on each
  // query: currency_id -> core.currencies is a CROSS-SCHEMA relationship
  // (accounting -> core) that PostgREST can't embed, and attempting it errors the
  // whole query (which previously blanked these lists entirely).
  const { data: currencyRows } = await supabase.schema("core").from("currencies").select("id, symbol");
  const symbolById = new Map((currencyRows ?? []).map((c) => [c.id, c.symbol] as const));
  const symbolFor = (currencyId: string | null | undefined) => (currencyId ? symbolById.get(currencyId) ?? null : null);

  switch (voucherType) {
    case "receipt_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("receipt_vouchers")
        .select("id, voucher_no, receipt_date, total_amount, exchange_rate, currency_id, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      const receipts = data ?? [];
      // "Received from" is the credited party (tenant/customer) held on the
      // receipt LINES — not the Cash/Bank account debited on the header. Resolve
      // the line accounts separately (a cross-table embed here proved fragile).
      const partyByReceipt = await resolvePartyFromLines(
        supabase,
        "receipt_voucher_lines",
        receipts.map((r) => r.id),
      );
      return receipts.map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.receipt_date,
        party: partyByReceipt.get(r.id) ?? "—",
        amount: r.total_amount,
        currencySymbol: symbolFor(r.currency_id),
        baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "payment_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("payment_vouchers")
        .select("id, voucher_no, payment_date, total_amount, exchange_rate, currency_id, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      const payments = data ?? [];
      // "Paid to" is the debited party held on the payment LINES — not the
      // Cash/Bank account credited on the header.
      const partyByPayment = await resolvePartyFromLines(
        supabase,
        "payment_voucher_lines",
        payments.map((r) => r.id),
      );
      return payments.map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.payment_date,
        party: partyByPayment.get(r.id) ?? "—",
        amount: r.total_amount,
        currencySymbol: symbolFor(r.currency_id),
        baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "pdc_payment_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("pdc_payment_vouchers")
        .select("id, voucher_no, cheque_date, payee, total_amount, exchange_rate, currency_id, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.cheque_date,
        party: r.payee,
        amount: r.total_amount,
        currencySymbol: symbolFor(r.currency_id),
        baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "pdc_receipt_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("pdc_receipt_vouchers")
        .select("id, voucher_no, cheque_date, payer, total_amount, exchange_rate, currency_id, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.cheque_date,
        party: r.payer,
        amount: r.total_amount,
        currencySymbol: symbolFor(r.currency_id),
        baseAmount: Number(r.total_amount) * Number(r.exchange_rate ?? 1),
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "cheque_return_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("cheque_return_vouchers")
        .select("id, voucher_no, return_date, return_reason, penalty_amount, exchange_rate, currency_id, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.return_date,
        party: r.return_reason,
        amount: r.penalty_amount,
        currencySymbol: symbolFor(r.currency_id),
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
    case "multi_currency_journal": {
      const { data } = await supabase
        .schema("accounting")
        .from("multi_currency_journal_vouchers")
        .select("id, voucher_no, entry_date, narration, journal_entry_id, journal_entries:journal_entry_id(status)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        voucherNo: r.voucher_no,
        date: r.entry_date,
        party: r.narration ?? "—",
        amount: 0,
        journalEntryId: r.journal_entry_id,
        status: (r.journal_entries as unknown as { status: JournalEntryStatus }).status,
      }));
    }
    case "opening_balance_voucher": {
      const { data } = await supabase
        .schema("accounting")
        .from("opening_balance_vouchers")
        .select(
          "id, voucher_no, as_of_date, total_amount, exchange_rate, currency_id, journal_entry_id, journal_entries:journal_entry_id(status)",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      const vouchers = data ?? [];

      // Resolve each voucher's property/asset account(s) from its lines, fetched
      // separately — a nested embed here proved fragile and could blank the list.
      const voucherIds = vouchers.map((v) => v.id);
      const linesByVoucher = new Map<string, { debit: number; account_id: string }[]>();
      const accountNameById = new Map<string, string>();
      if (voucherIds.length) {
        const { data: obLines } = await supabase
          .schema("accounting")
          .from("opening_balance_voucher_lines")
          .select("voucher_id, debit, account_id")
          .in("voucher_id", voucherIds);
        for (const l of obLines ?? []) {
          const arr = linesByVoucher.get(l.voucher_id) ?? [];
          arr.push({ debit: Number(l.debit), account_id: l.account_id });
          linesByVoucher.set(l.voucher_id, arr);
        }
        const accountIds = [...new Set((obLines ?? []).map((l) => l.account_id))];
        if (accountIds.length) {
          const { data: accts } = await supabase
            .schema("accounting")
            .from("chart_of_accounts")
            .select("id, account_name")
            .in("id", accountIds);
          for (const a of accts ?? []) accountNameById.set(a.id, a.account_name);
        }
      }

      // Show the property/asset account(s) the opening balance was booked to —
      // not the CAPITAL contra — and the amount in its own transaction currency.
      return vouchers.map((r) => {
        const lines = linesByVoucher.get(r.id) ?? [];
        const source = lines.filter((l) => l.debit > 0); // debit side holds the asset
        const names = [
          ...new Set((source.length ? source : lines).map((l) => accountNameById.get(l.account_id)).filter(Boolean)),
        ];
        const party = names.length === 1 ? (names[0] as string) : names.length > 1 ? `Split (${names.length})` : "—";
        return {
          id: r.id,
          voucherNo: r.voucher_no,
          date: r.as_of_date,
          party,
          amount: r.total_amount,
          currencySymbol: symbolFor(r.currency_id),
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
        "debit_amount, credit_amount, currency_id, base_debit_amount, base_credit_amount, description, reference, chart_of_accounts:account_id(account_code, account_name), cost_centers:cost_center_id(name)",
      )
      .eq("journal_entry_id", journalEntryId)
      .order("line_no"),
  ]);

  const { data: currency } = je?.currency_id
    ? await supabase.schema("core").from("currencies").select("code, symbol").eq("id", je.currency_id).maybeSingle()
    : { data: null };
  const cur = currency as { code: string; symbol: string } | null;

  // Per-line currencies (Multi-Currency Journal): resolve every distinct
  // currency_id on the lines to its code/symbol in one lookup (a cross-schema
  // embed can't be nested here).
  const lineCurrencyIds = [...new Set((lines ?? []).map((l) => l.currency_id as string).filter(Boolean))];
  const lineCurrencyById = new Map<string, { code: string; symbol: string }>();
  if (lineCurrencyIds.length) {
    const { data: curRows } = await supabase
      .schema("core")
      .from("currencies")
      .select("id, code, symbol")
      .in("id", lineCurrencyIds);
    for (const c of curRows ?? []) lineCurrencyById.set(c.id as string, { code: c.code as string, symbol: c.symbol as string });
  }

  return {
    status: (je?.status ?? "draft") as JournalEntryStatus,
    narration: je?.narration ?? null,
    exchangeRate: (je?.exchange_rate as number | null) ?? 1,
    currencyCode: cur?.code ?? "",
    currencySymbol: cur?.symbol ?? null,
    lines: (lines ?? []).map((l) => {
      const account = l.chart_of_accounts as unknown as { account_code: string; account_name: string } | null;
      const costCenter = l.cost_centers as unknown as { name: string } | null;
      const lineCur = lineCurrencyById.get(l.currency_id as string) ?? null;
      return {
        accountCode: account?.account_code ?? "",
        accountName: account?.account_name ?? "",
        costCenterName: costCenter?.name ?? null,
        debit: l.debit_amount,
        credit: l.credit_amount,
        description: l.description,
        reference: (l.reference as string | null) ?? null,
        currencyCode: lineCur?.code ?? null,
        currencySymbol: lineCur?.symbol ?? null,
        baseDebit: Number(l.base_debit_amount) || 0,
        baseCredit: Number(l.base_credit_amount) || 0,
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
          { label: "Debit account (Cash/Bank)", value: debit ? `${formatAccountCode(debit.account_code)} — ${debit.account_name}` : "—" },
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
          { label: "Credit account (Cash/Bank)", value: credit ? `${formatAccountCode(credit.account_code)} — ${credit.account_name}` : "—" },
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
          { label: "Credit account (PDC liability)", value: credit ? `${formatAccountCode(credit.account_code)} — ${credit.account_name}` : "—" },
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
          { label: "Debit account (PDC asset)", value: debit ? `${formatAccountCode(debit.account_code)} — ${debit.account_name}` : "—" },
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
          { label: "Contra account (Opening Balance Equity)", value: contra ? `${formatAccountCode(contra.account_code)} — ${contra.account_name}` : "—" },
          { label: "Cost center", value: costCenter?.name ?? "—" },
          { label: "Currency conv.", value: formatRate(v.exchange_rate) },
          { label: "Total", value: v.total_amount.toLocaleString() },
        ],
        lines: je.lines,
      };
    }
    case "multi_currency_journal": {
      const { data: v } = await supabase
        .schema("accounting")
        .from("multi_currency_journal_vouchers")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .maybeSingle();
      if (!v) return null;
      const je = await getJournalEntryWithLines(v.journal_entry_id);
      const baseDebitTotal = je.lines.reduce((s, l) => s + (l.baseDebit ?? 0), 0);
      return {
        id: v.id,
        voucherNo: v.voucher_no,
        date: v.entry_date,
        narration: v.narration,
        journalEntryId: v.journal_entry_id,
        status: je.status,
        // The header carries the base currency; each line shows its own.
        currencyCode: je.currencyCode,
        currencySymbol: je.currencySymbol,
        exchangeRate: je.exchangeRate,
        fields: [
          { label: "Base currency", value: je.currencyCode || "—" },
          {
            label: `Total (base ${je.currencyCode})`.trim(),
            value: `${je.currencySymbol ? je.currencySymbol + " " : ""}${baseDebitTotal.toLocaleString()}`,
          },
        ],
        lines: je.lines,
      };
    }
  }
}
