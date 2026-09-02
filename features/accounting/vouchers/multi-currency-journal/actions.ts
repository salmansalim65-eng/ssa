"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId, postVoucher, routeNewVoucher } from "@/lib/vouchers/engine";
import { multiCurrencyJournalSchema, type MultiCurrencyJournalInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const LIST_PATH = "/accounting/vouchers/multi_currency_journal";

type Supa = Awaited<ReturnType<typeof createClient>>;

// The journal-entry header must carry a currency; a multi-currency voucher has
// no single one, so we stamp the company BASE currency (rate 1) — the real
// per-line currencies live on each journal_entry_line. Returns null when the
// company has no base currency configured (an install error the caller reports).
async function getBaseCurrencyId(supabase: Supa, companyId: string): Promise<string | null> {
  const { data } = await supabase
    .schema("core")
    .from("company_currencies")
    .select("currency_id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .eq("is_base_currency", true)
    .maybeSingle();
  return (data?.currency_id as string | undefined) ?? null;
}

// Expand the form's raw Dr/Cr rows into journal_entry_lines, each tagged with
// its own currency + rate + base amounts (base = amount × rate).
function toEntryLineRows(jeId: string, lines: MultiCurrencyJournalInput["lines"]) {
  return lines.map((l, index) => {
    const isDebit = l.side === "debit";
    const base = round2(l.amount * l.exchangeRate);
    return {
      journal_entry_id: jeId,
      line_no: index + 1,
      account_id: l.accountId,
      cost_center_id: l.costCenterId || null,
      debit_amount: isDebit ? l.amount : 0,
      credit_amount: isDebit ? 0 : l.amount,
      currency_id: l.currencyId,
      exchange_rate: l.exchangeRate,
      base_debit_amount: isDebit ? base : 0,
      base_credit_amount: isDebit ? 0 : base,
      description: null as string | null,
    };
  });
}

export async function createMultiCurrencyJournal(
  input: MultiCurrencyJournalInput,
  options?: { autoPostIfAdmin?: boolean },
) {
  const parsed = multiCurrencyJournalSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("multi_currency_journal", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const baseCurrencyId = await getBaseCurrencyId(supabase, companyId);
  if (!baseCurrencyId) return { error: "No base currency configured for this company." };

  const voucherId = crypto.randomUUID();

  // Header journal entry — base currency, rate 1 (the lines carry the real
  // per-line currencies and rates).
  const { data: je, error: jeError } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .insert({
      company_id: companyId,
      entry_date: parsed.data.entryDate,
      voucher_type: "multi_currency_journal",
      voucher_id: voucherId,
      currency_id: baseCurrencyId,
      exchange_rate: 1,
      narration: parsed.data.narration || null,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (jeError || !je) return { error: jeError?.message ?? "Failed to create journal entry" };
  const jeId = je.id as string;

  const { error: linesError } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .insert(toEntryLineRows(jeId, parsed.data.lines));
  if (linesError) return { error: linesError.message };

  const { error: vErr } = await supabase.schema("accounting").from("multi_currency_journal_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: jeId,
    entry_date: parsed.data.entryDate,
    narration: parsed.data.narration || null,
    created_by: createdBy,
  });
  if (vErr) return { error: vErr.message };

  revalidatePath(LIST_PATH);
  revalidatePath("/dashboard");
  // An admin's voucher posts on the spot; anyone else's goes straight to the
  // approver — no "Submit for approval" click in between.
  if (options?.autoPostIfAdmin !== false) {
    await routeNewVoucher({
      companyId,
      voucherType: "multi_currency_journal",
      voucherId,
      journalEntryId: jeId,
      post: () => postMultiCurrencyJournal(voucherId, jeId),
    });
  }
  return { success: true, id: voucherId };
}

export async function updateMultiCurrencyJournal(id: string, input: MultiCurrencyJournalInput) {
  const parsed = multiCurrencyJournalSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("multi_currency_journal", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("multi_currency_journal_vouchers")
    .select("journal_entry_id")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!v) return { error: "Voucher not found" };

  const jeId = v.journal_entry_id as string;
  const { data: je } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .select("status")
    .eq("id", jeId)
    .single();
  if (!je) return { error: "Voucher not found" };
  if (je.status !== "draft") return { error: "Only draft vouchers can be edited" };

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({ entry_date: parsed.data.entryDate, narration: parsed.data.narration || null })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  const { error: delErr } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", jeId);
  if (delErr) return { error: delErr.message };

  const { error: insErr } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .insert(toEntryLineRows(jeId, parsed.data.lines));
  if (insErr) return { error: insErr.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("multi_currency_journal_vouchers")
    .update({ entry_date: parsed.data.entryDate, narration: parsed.data.narration || null })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  revalidatePath("/dashboard");
  return { success: true, id };
}

export async function postMultiCurrencyJournal(id: string, journalEntryId: string) {
  await requirePermission("multi_currency_journal", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "multi_currency_journal", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("multi_currency_journal_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(LIST_PATH);
  revalidatePath("/dashboard");
  return { success: true, voucherNo: result.voucherNo };
}
