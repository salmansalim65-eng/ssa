import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { HhLeaseForm } from "@/components/rental/hh-lease-form";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadTenantAccounts } from "@/lib/rental/tenant-accounts";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

// Expense accounts a HH lease can charge: the non-group accounts sitting under
// the Chart-of-Accounts "Rental Expenses" group. Matches the group name loosely
// (case-insensitive, allowing surrounding words like "HH Rental Expenses") and
// collects children at any depth beneath it, so the setup is forgiving. Empty
// only when no such group/accounts exist yet.
async function loadRentalExpenseAccounts(companyId: string) {
  const supabase = await createClient();
  const { data: allAccounts } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_code, account_name, parent_id, is_group")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("account_code");
  const rows = allAccounts ?? [];

  // Find the "Rental Expenses" group node (prefer an actual group; fall back to
  // any account whose name contains "rental expense").
  // Match RENTAL / RENTEL / RENT EXPENSE(S) — the group name is sometimes
  // misspelled in the Chart of Accounts.
  const groups = rows.filter((r) => /rent[a-z]*\s*expense/i.test(String(r.account_name ?? "")));
  const groupNode = groups.find((r) => r.is_group) ?? groups[0];
  if (!groupNode) return [];

  // Collect every descendant of that node, then keep the postable (non-group)
  // ones — so accounts nested under sub-groups are included too.
  const childrenByParent = new Map<string, typeof rows>();
  for (const r of rows) {
    const p = r.parent_id as string | null;
    if (!p) continue;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(r);
  }
  const out: { id: string; account_code: string; account_name: string }[] = [];
  const stack = [...(childrenByParent.get(groupNode.id as string) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.is_group) {
      stack.push(...(childrenByParent.get(node.id as string) ?? []));
    } else {
      out.push({
        id: node.id as string,
        account_code: node.account_code as string,
        account_name: node.account_name as string,
      });
    }
  }
  return out.sort((a, b) => a.account_code.localeCompare(b.account_code));
}

/**
 * The last HH invoice, offered as the starting point for the next one.
 *
 * HH is billed one invoice a month for every property at once, and month to
 * month it is largely the same grid: the same properties, the same rents, the
 * same terms. Re-keying it invites both typos and omissions — and an omission is
 * the worst kind, because a property left off looks exactly like one that was
 * empty. So the previous invoice comes back as a draft to correct: change what
 * moved, mark what stood empty.
 *
 * Vacant lines are carried across as ordinary properties, not as vacancies: last
 * month's emptiness says nothing about this month's.
 */
async function loadLastHhInvoice(companyId: string) {
  const supabase = await createClient();
  const { data: latest } = await supabase
    .schema("rental")
    .from("uae_leases")
    .select("document_no, rent_month, created_at")
    .eq("company_id", companyId)
    .eq("lease_type", "hh")
    .not("document_no", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest?.document_no) return undefined;

  const { data: lines } = await supabase
    .schema("rental")
    .from("uae_leases")
    .select("id, asset_id, rental_amount, lease_start, lease_end, payment_terms, remarks")
    .eq("company_id", companyId)
    .eq("document_no", latest.document_no as string)
    .is("deleted_at", null)
    .order("created_at");
  if (!lines?.length) return undefined;

  const { data: expenses } = await supabase
    .schema("rental")
    .from("lease_expenses")
    .select("lease_id, account_id, amount")
    .in("lease_id", lines.map((l) => l.id as string));
  const expensesByLease = new Map<string, { accountId: string; amount: number }[]>();
  for (const e of expenses ?? []) {
    const key = e.lease_id as string;
    const list = expensesByLease.get(key) ?? [];
    list.push({ accountId: e.account_id as string, amount: Number(e.amount) });
    expensesByLease.set(key, list);
  }

  return {
    documentNo: latest.document_no as string,
    rentMonth: (latest.rent_month as string | null) ?? null,
    lines: lines.map((l) => ({
      assetId: (l.asset_id as string) ?? "",
      rentalAmount: Number(l.rental_amount),
      leaseStart: l.lease_start as string,
      leaseEnd: l.lease_end as string,
      paymentTerms: ((l.payment_terms as string) ?? "monthly") as "advance" | "monthly" | "quarterly" | "half_yearly" | "yearly",
      remarks: (l.remarks as string | null) ?? "",
      expenses: expensesByLease.get(l.id as string) ?? [],
      vacant: false,
    })),
  };
}

/** Months that already carry an HH invoice, so a second one is flagged early. */
async function loadInvoicedMonths(companyId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("rental")
    .from("uae_leases")
    .select("rent_month")
    .eq("company_id", companyId)
    .eq("lease_type", "hh")
    .not("rent_month", "is", null)
    .is("deleted_at", null);
  return [...new Set((data ?? []).map((r) => r.rent_month as string))];
}

export default async function NewHhLeasePage() {

  const canCreate = await hasPermission("uae_rent_invoice", "create");
  if (!canCreate) redirect("/rental/uae/hh-lease");

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: assets }, tenants, { data: companyCurrencies }, expenseAccounts, lastInvoice, invoicedMonths] =
    await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, asset_code, asset_name")
      .eq("company_id", companyId)
      .eq("country", "AE")
      .eq("is_rental", true)
      .is("deleted_at", null)
      .order("asset_code"),
    // HH tenants come from the Chart of Accounts tenant group (country = AE).
    loadTenantAccounts(companyId, "AE"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    loadRentalExpenseAccounts(companyId),
    loadLastHhInvoice(companyId),
    loadInvoicedMonths(companyId),
  ]);

  type RawCurrency = { is_base_currency: boolean; currencies: { id: string; code: string } | null };
  const rawCurrencies = ((companyCurrencies as unknown as RawCurrency[]) ?? []).filter((cc) => cc.currencies);
  const currencyOptions = rawCurrencies.map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));
  // HH leases are UAE leases — default to AED; fall back to base currency.
  const defaultCurrencyId =
    rawCurrencies.find((cc) => cc.currencies!.code === "AED")?.currencies!.id ??
    rawCurrencies.find((cc) => cc.is_base_currency)?.currencies!.id;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="New HH Rent Invoice"
        description="One month, one tenant, every property. Start from last month's invoice, correct what moved, and mark anything that stood empty as vacant — it posts as a single rent invoice with one accounting entry."
        backHref="/rental/uae/hh-lease"
      />
      <HhLeaseForm
        assets={assets ?? []}
        tenants={tenants ?? []}
        currencies={currencyOptions}
        defaultCurrencyId={defaultCurrencyId}
        expenseAccounts={expenseAccounts}
        monthly
        lastInvoice={lastInvoice}
        invoicedMonths={invoicedMonths}
      />
    </div>
  );
}
