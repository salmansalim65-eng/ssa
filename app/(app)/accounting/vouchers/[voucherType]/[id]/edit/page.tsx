import { notFound, redirect } from "next/navigation";

import { PaymentVoucherForm } from "@/components/vouchers/forms/payment-voucher-form";
import { ReceiptVoucherForm } from "@/components/vouchers/forms/receipt-voucher-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { isPhase5VoucherType, VOUCHER_TYPE_LABELS } from "@/lib/vouchers/meta";
import type { JournalEntryStatus } from "@/types/database.types";

// Voucher types whose draft can currently be re-opened in its form.
const EDITABLE_VOUCHER_TYPES = ["receipt_voucher", "payment_voucher"] as const;

export default async function EditVoucherPage({
  params,
}: {
  params: Promise<{ voucherType: string; id: string }>;
}) {
  const { voucherType, id } = await params;
  if (!isPhase5VoucherType(voucherType)) notFound();

  const detailHref = `/accounting/vouchers/${voucherType}/${id}`;
  // Only the single-line vouchers support edit for now; others fall back to detail.
  if (!(EDITABLE_VOUCHER_TYPES as readonly string[]).includes(voucherType)) redirect(detailHref);

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

  const table = voucherType === "receipt_voucher" ? "receipt_vouchers" : "payment_vouchers";
  const { data: voucher } = await supabase
    .schema("accounting")
    .from(table)
    .select("*, journal_entries:journal_entry_id(status)")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!voucher) notFound();

  const status =
    (voucher as unknown as { journal_entries: { status: JournalEntryStatus } | null }).journal_entries?.status ??
    "draft";
  // A posted (or in-approval) voucher is part of the ledger — send the user back.
  if (status !== "draft") redirect(detailHref);

  const v = voucher as unknown as Record<string, unknown>;

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
    </div>
  );
}
