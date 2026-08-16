import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { ChequeReturnVoucherForm, type ReturnablePdcOption } from "@/components/vouchers/forms/cheque-return-voucher-form";
import { JournalVoucherForm } from "@/components/vouchers/forms/journal-voucher-form";
import { JvMaintenanceVoucherForm } from "@/components/vouchers/forms/jv-maintenance-voucher-form";
import { OpeningBalanceVoucherForm } from "@/components/vouchers/forms/opening-balance-voucher-form";
import { PaymentVoucherForm } from "@/components/vouchers/forms/payment-voucher-form";
import { PdcPaymentVoucherForm } from "@/components/vouchers/forms/pdc-payment-voucher-form";
import { PdcReceiptVoucherForm } from "@/components/vouchers/forms/pdc-receipt-voucher-form";
import { ReceiptVoucherForm } from "@/components/vouchers/forms/receipt-voucher-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { mapVoucherCurrencies, type RawCompanyCurrency } from "@/lib/vouchers/currencies";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { isPhase5VoucherType, VOUCHER_TYPE_LABELS } from "@/lib/vouchers/meta";
import { isJournalTabType, VoucherTypeTabs } from "@/components/vouchers/voucher-type-tabs";

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
  const companyId = await getCurrentCompanyId();

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
      .select("is_base_currency, currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, name, asset_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
  ]);

  const accountOptions = accounts ?? [];

  // Enrich cost centres with the JV Service Charges auto-fill amount: the linked
  // asset's Service Charges Amount (UAE) or Property Tax (Pakistan).
  const ccAssetIds = [
    ...new Set((costCenters ?? []).map((c) => c.asset_id as string | null).filter(Boolean)),
  ] as string[];
  const { data: chargeAssets } = ccAssetIds.length
    ? await supabase
        .schema("assets")
        .from("assets")
        .select("id, country, service_charges_amount, property_tax")
        .in("id", ccAssetIds)
    : { data: [] };
  const chargeByAsset = new Map(
    (chargeAssets ?? []).map((a) => [
      a.id as string,
      a.country === "AE"
        ? Number(a.service_charges_amount ?? 0)
        : a.country === "PK"
          ? Number(a.property_tax ?? 0)
          : 0,
    ]),
  );
  const costCenterOptions = (costCenters ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    chargeAmount: c.asset_id ? chargeByAsset.get(c.asset_id as string) ?? 0 : 0,
  }));
  const today = new Date().toISOString().slice(0, 10);
  // Options are ordered base-currency-first so each voucher form defaults its
  // currency to the system base currency (dynamic — see mapVoucherCurrencies).
  const currencyOptions = await mapVoucherCurrencies(
    companyId,
    today,
    companyCurrencies as unknown as RawCompanyCurrency[],
  );

  // Open rental invoices a receipt line can be applied against (reduces
  // outstanding when the receipt posts).
  let openInvoices: { id: string; country: "UAE" | "PK"; label: string }[] = [];
  if (voucherType === "receipt_voucher" || voucherType === "payment_voucher") {
    const { data: inv } = await supabase
      .schema("reporting")
      .from("v_outstanding_rent")
      .select("invoice_id, country, voucher_no, tenant_name, asset_name, outstanding_balance, currency_code")
      .eq("company_id", companyId)
      .order("due_date");
    openInvoices = (inv ?? []).map((r) => ({
      id: r.invoice_id as string,
      country: r.country as "UAE" | "PK",
      label: `${r.voucher_no ?? "Draft"} · ${r.tenant_name ?? ""} · ${r.asset_name ?? ""} — ${r.currency_code ?? ""} ${Math.round(Number(r.outstanding_balance)).toLocaleString("en-US")}`,
    }));
  }

  let extra: { pdcOptions?: ReturnablePdcOption[] } = {};

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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Vouchers"
        title={`New ${VOUCHER_TYPE_LABELS[voucherType]}`}
        description="Fill in the header details and entry lines, then save as a draft."
        backHref={`/accounting/vouchers/${voucherType}`}
      />

      {isJournalTabType(voucherType) && <VoucherTypeTabs active={voucherType} mode="new" />}

      {voucherType === "receipt_voucher" && (
        <ReceiptVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
          openInvoices={openInvoices}
        />
      )}
      {voucherType === "payment_voucher" && (
        <PaymentVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
          openInvoices={openInvoices}
        />
      )}
      {voucherType === "pdc_payment_voucher" && (
        <PdcPaymentVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
        />
      )}
      {voucherType === "pdc_receipt_voucher" && (
        <PdcReceiptVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
        />
      )}
      {voucherType === "opening_balance_voucher" && (
        <OpeningBalanceVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
        />
      )}
      {voucherType === "journal_voucher" && (
        <JournalVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
        />
      )}
      {voucherType === "jv_maintenance_voucher" && (
        <JvMaintenanceVoucherForm
          accounts={accountOptions}
          currencies={currencyOptions}
          costCenters={costCenterOptions}
        />
      )}
      {voucherType === "cheque_return_voucher" && (
        <ChequeReturnVoucherForm pdcOptions={extra.pdcOptions ?? []} accounts={accountOptions} />
      )}
    </div>
  );
}
