import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { HhLeaseForm } from "@/components/rental/hh-lease-form";
import { updateHhRentInvoice, updateUaeRentInvoice } from "@/features/rental/hh-leases/actions";
import { isCurrentUserAdmin } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadTenantAccounts } from "@/lib/rental/tenant-accounts";
import { loadRentalExpenseAccounts } from "@/lib/rental/rental-expense-accounts";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

function round2(n: number) {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

// Whole calendar months a period spans, inclusive (mirrors the create action).
function monthsBetween(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
}

export default async function EditRentInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isCurrentUserAdmin())) redirect(`/rental/uae/invoices/${id}`);

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const { data: invoice } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .select("id, lease_id, invoice_date, currency_id, invoice_type, schedule_id")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!invoice) notFound();
  // Only the combined (grid) invoices are edited here; schedule-based ones use
  // the simple dialog.
  if (invoice.schedule_id) redirect(`/rental/uae/invoices/${id}`);

  const { data: firstLease } = await supabase
    .schema("rental")
    .from("uae_leases")
    .select("document_no, rent_cycle, tenant_id")
    .eq("id", invoice.lease_id)
    .maybeSingle();
  const documentNo = firstLease?.document_no as string | null;

  // Every property lease of this voucher (shared document number).
  const { data: leases } = documentNo
    ? await supabase
        .schema("rental")
        .from("uae_leases")
        .select("id, asset_id, rental_amount, lease_start, lease_end, remarks")
        .eq("company_id", companyId)
        .eq("document_no", documentNo)
        .is("deleted_at", null)
        .order("created_at")
    : { data: [] };
  const leaseRows = leases ?? [];

  // Named expenses per lease.
  const { data: expenseRows } = await supabase
    .schema("rental")
    .from("lease_expenses")
    .select("lease_id, account_id, amount")
    .in("lease_id", leaseRows.map((l) => l.id));
  const expensesByLease = new Map<string, { accountId: string; amount: number }[]>();
  for (const e of expenseRows ?? []) {
    const list = expensesByLease.get(e.lease_id as string) ?? [];
    if (e.account_id) list.push({ accountId: e.account_id as string, amount: Number(e.amount) });
    expensesByLease.set(e.lease_id as string, list);
  }

  // The tenant dropdown is keyed by Chart-of-Accounts account id.
  const { data: tenant } = firstLease?.tenant_id
    ? await supabase.schema("rental").from("tenants").select("account_id").eq("id", firstLease.tenant_id).maybeSingle()
    : { data: null };
  const tenantAccountId = (tenant?.account_id as string | null) ?? "";

  const [{ data: assets }, tenants, { data: companyCurrencies }, expenseAccounts] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name")
      .eq("company_id", companyId)
      .eq("country", "AE")
      .eq("is_rental", true)
      .is("deleted_at", null)
      .order("asset_code"),
    loadTenantAccounts(companyId, "AE"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    loadRentalExpenseAccounts(companyId),
  ]);

  type RawCurrency = { is_base_currency: boolean; currencies: { id: string; code: string } | null };
  const rawCurrencies = ((companyCurrencies as unknown as RawCurrency[]) ?? []).filter((cc) => cc.currencies);
  const currencyOptions = rawCurrencies.map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  const isHh = invoice.invoice_type === "HH";
  const initialValues = {
    tenantId: tenantAccountId,
    documentDate: invoice.invoice_date as string,
    currencyId: invoice.currency_id as string,
    rentCycle: (firstLease?.rent_cycle as "monthly" | "yearly") ?? "monthly",
    lines: leaseRows.map((l) => ({
      assetId: l.asset_id as string,
      // Rebuild the period-total rent the user typed (lease stores the monthly).
      rentalAmount: round2(
        Number(l.rental_amount) * monthsBetween(l.lease_start as string, l.lease_end as string),
      ),
      leaseStart: l.lease_start as string,
      leaseEnd: l.lease_end as string,
      expenses: expensesByLease.get(l.id as string) ?? [],
      remarks: (l.remarks as string | null) ?? "",
    })),
  };

  const action = (isHh ? updateHhRentInvoice : updateUaeRentInvoice).bind(null, id);
  const docLabel = isHh ? "HH Rent Invoice" : "UAE Rent Invoice";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title={`Edit ${docLabel}`}
        description="Change amounts, dates or properties, or add more. Saving rebuilds the invoice and its accounting entry, keeping the same document number."
        backHref={`/rental/uae/invoices/${id}`}
      />
      <HhLeaseForm
        assets={assets ?? []}
        tenants={tenants ?? []}
        currencies={currencyOptions}
        expenseAccounts={expenseAccounts}
        createAction={action}
        docLabel={docLabel}
        submitLabel={`Update ${docLabel}`}
        managementPct={isHh ? 0.1 : 0.05}
        initialValues={initialValues}
        redirectHref={isHh ? "/rental/uae/hh-lease" : "/rental/uae/leases"}
      />
    </div>
  );
}
