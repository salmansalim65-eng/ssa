import { notFound, redirect } from "next/navigation";

import { ChequeReturnVoucherForm, type ReturnablePdcOption } from "@/components/vouchers/forms/cheque-return-voucher-form";
import { JournalVoucherForm } from "@/components/vouchers/forms/journal-voucher-form";
import { JvMaintenanceVoucherForm, type JournalVoucherOption } from "@/components/vouchers/forms/jv-maintenance-voucher-form";
import { OpeningBalanceVoucherForm } from "@/components/vouchers/forms/opening-balance-voucher-form";
import { PaymentVoucherForm } from "@/components/vouchers/forms/payment-voucher-form";
import { PdcPaymentVoucherForm } from "@/components/vouchers/forms/pdc-payment-voucher-form";
import { PdcReceiptVoucherForm } from "@/components/vouchers/forms/pdc-receipt-voucher-form";
import { ReceiptVoucherForm } from "@/components/vouchers/forms/receipt-voucher-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { isPhase5VoucherType, VOUCHER_TYPE_LABELS } from "@/lib/vouchers/meta";

export default async function NewVoucherPage({
  params,
}: {
  params: Promise<{ voucherType: string }>;
}) {
  const { voucherType } = await params;
  if (!isPhase5VoucherType(voucherType)) notFound();

  const canCreate = await hasPermission(voucherType, "create");
  if (!canCreate) redirect(`/accounting/vouchers/${voucherType}`);

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: accounts }, { data: companyCurrencies }, { data: costCenters }] = await Promise.all([
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
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
  ]);

  const accountOptions = accounts ?? [];
  const costCenterOptions = costCenters ?? [];
  type RawCurrency = { currencies: { id: string; code: string } | null };
  const today = new Date().toISOString().slice(0, 10);
  // Currency options carry a conversion rate seeded from the exchange-rate table
  // (base currency = 1); the header vouchers use it for "Currency Conv.".
  const currencyOptions = await Promise.all(
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
  );

  let extra: { journalVouchers?: JournalVoucherOption[]; pdcOptions?: ReturnablePdcOption[] } = {};

  if (voucherType === "jv_maintenance_voucher") {
    const { data: jvs } = await supabase
      .schema("accounting")
      .from("journal_vouchers")
      .select("id, voucher_no")
      .eq("company_id", companyId)
      .not("voucher_no", "is", null)
      .order("created_at", { ascending: false });
    extra = { journalVouchers: (jvs ?? []).map((jv) => ({ id: jv.id, voucherNo: jv.voucher_no })) };
  }

  if (voucherType === "cheque_return_voucher") {
    const [{ data: pdcPayments }, { data: pdcReceipts }] = await Promise.all([
      supabase
        .schema("accounting")
        .from("pdc_payment_vouchers")
        .select("id, cheque_no, payee")
        .eq("company_id", companyId)
        .eq("pdc_status", "pending"),
      supabase
        .schema("accounting")
        .from("pdc_receipt_vouchers")
        .select("id, cheque_no, payer")
        .eq("company_id", companyId)
        .eq("pdc_status", "pending"),
    ]);
    extra = {
      pdcOptions: [
        ...(pdcPayments ?? []).map((p) => ({
          id: p.id,
          type: "pdc_payment_voucher" as const,
          label: `Payment — ${p.cheque_no} (${p.payee})`,
        })),
        ...(pdcReceipts ?? []).map((p) => ({
          id: p.id,
          type: "pdc_receipt_voucher" as const,
          label: `Receipt — ${p.cheque_no} (${p.payer})`,
        })),
      ],
    };
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New {VOUCHER_TYPE_LABELS[voucherType]}</h1>

      {voucherType === "receipt_voucher" && (
        <ReceiptVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
        />
      )}
      {voucherType === "payment_voucher" && (
        <PaymentVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
        />
      )}
      {voucherType === "pdc_payment_voucher" && (
        <PdcPaymentVoucherForm accounts={accountOptions} currencies={currencyOptions} />
      )}
      {voucherType === "pdc_receipt_voucher" && (
        <PdcReceiptVoucherForm accounts={accountOptions} currencies={currencyOptions} />
      )}
      {voucherType === "opening_balance_voucher" && (
        <OpeningBalanceVoucherForm accounts={accountOptions} currencies={currencyOptions} />
      )}
      {voucherType === "journal_voucher" && (
        <JournalVoucherForm accounts={accountOptions} currencies={currencyOptions} />
      )}
      {voucherType === "jv_maintenance_voucher" && (
        <JvMaintenanceVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          journalVouchers={extra.journalVouchers ?? []}
        />
      )}
      {voucherType === "cheque_return_voucher" && (
        <ChequeReturnVoucherForm pdcOptions={extra.pdcOptions ?? []} accounts={accountOptions} />
      )}
    </div>
  );
}
