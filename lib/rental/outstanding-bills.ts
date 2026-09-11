import "server-only";

import { createClient } from "@/lib/supabase/server";
import { billingMonthStarts, rentDueChunks } from "@/lib/rental/billing-months";

/**
 * The rental bills a receipt or payment can be adjusted against.
 *
 * A combined HH/UAE voucher is ONE invoice covering many properties over many
 * months, and offering it as a single bill is what broke a receipt: paying the
 * overdue 42,029 filled the first bill with its whole remaining 32,549.40 —
 * August AND September — so 5,721 of the money prepaid September and left
 * August's next bill short by the same amount.
 *
 * Such an invoice is therefore offered here the way the Rent Balance shows it:
 * one bill per property per instalment, at the date that instalment falls due,
 * for its own share of what is still outstanding. Both screens read the same
 * rule (rentDueChunks), so settling what the report calls overdue settles
 * exactly those months.
 *
 * An invoice billed off a payment schedule is already one instalment, and a
 * Pakistan invoice is a single property, so both are offered whole.
 */
export interface OutstandingRentBill {
  /** Unique per row. A split invoice yields several rows sharing invoiceId. */
  key: string;
  invoiceId: string;
  country: "UAE" | "PK";
  accountId: string | null;
  reference: string;
  dueDate: string | null;
  billAmount: number;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function loadOutstandingRentBills(companyId: string): Promise<OutstandingRentBill[]> {
  const supabase = await createClient();

  const { data: inv } = await supabase
    .schema("reporting")
    .from("v_outstanding_rent")
    .select(
      "invoice_id, country, tenant_account_id, voucher_no, tenant_name, asset_name, due_date, net_amount, net_outstanding",
    )
    .eq("company_id", companyId)
    .gt("net_outstanding", 0)
    .order("due_date");
  const rows = inv ?? [];
  if (rows.length === 0) return [];

  const whole = (r: (typeof rows)[number]): OutstandingRentBill => ({
    key: r.invoice_id as string,
    invoiceId: r.invoice_id as string,
    country: r.country as "UAE" | "PK",
    accountId: (r.tenant_account_id as string | null) ?? null,
    reference: [r.voucher_no ?? "Draft", r.tenant_name, r.asset_name].filter(Boolean).join(" · "),
    dueDate: (r.due_date as string | null) ?? null,
    billAmount: Number(r.net_outstanding),
  });

  const uaeIds = rows.filter((r) => r.country === "UAE").map((r) => r.invoice_id as string);
  if (uaeIds.length === 0) return rows.map(whole);

  // Which UAE invoices are combined vouchers (no schedule behind them), and
  // which properties each one covers — leases sharing its document number.
  const { data: invMeta } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .select("id, lease_id, schedule_id")
    .in("id", uaeIds);
  const metaById = new Map(
    ((invMeta as { id: string; lease_id: string; schedule_id: string | null }[]) ?? []).map((m) => [m.id, m]),
  );

  const firstLeaseIds = [...new Set([...metaById.values()].map((m) => m.lease_id).filter(Boolean))];
  const { data: firstLeases } = firstLeaseIds.length
    ? await supabase.schema("rental").from("uae_leases").select("id, document_no").in("id", firstLeaseIds)
    : { data: [] };
  const docByFirstLease = new Map(
    ((firstLeases as { id: string; document_no: string | null }[]) ?? []).map((l) => [l.id, l.document_no]),
  );
  const docNos = [...new Set([...docByFirstLease.values()].filter((d): d is string => Boolean(d)))];

  type VLease = {
    id: string;
    document_no: string | null;
    asset_id: string | null;
    rental_amount: number;
    lease_start: string;
    lease_end: string;
    lease_type: string | null;
    payment_terms: string | null;
    is_vacant: boolean | null;
  };
  const { data: voucherLeases } = docNos.length
    ? await supabase
        .schema("rental")
        .from("uae_leases")
        .select("id, document_no, asset_id, rental_amount, lease_start, lease_end, lease_type, payment_terms, is_vacant")
        .in("document_no", docNos)
        .is("deleted_at", null)
        .order("created_at")
    : { data: [] };
  const leases = ((voucherLeases as VLease[]) ?? []).filter((l) => !l.is_vacant);

  const leasesByDoc = new Map<string, VLease[]>();
  for (const l of leases) {
    const list = leasesByDoc.get(l.document_no as string) ?? [];
    list.push(l);
    leasesByDoc.set(l.document_no as string, list);
  }

  const assetIds = [...new Set(leases.map((l) => l.asset_id).filter((id): id is string => Boolean(id)))];
  const { data: assetRows } = assetIds.length
    ? await supabase.schema("assets").from("assets").select("id, asset_name").in("id", assetIds)
    : { data: [] };
  const assetName = new Map(((assetRows as { id: string; asset_name: string }[]) ?? []).map((a) => [a.id, a.asset_name]));

  const { data: expRows } = leases.length
    ? await supabase
        .schema("rental")
        .from("lease_expenses")
        .select("lease_id, amount")
        .in("lease_id", leases.map((l) => l.id))
    : { data: [] };
  const expByLease = new Map<string, number>();
  for (const e of (expRows as { lease_id: string; amount: number }[]) ?? []) {
    expByLease.set(e.lease_id, (expByLease.get(e.lease_id) ?? 0) + Number(e.amount));
  }

  const bills: OutstandingRentBill[] = [];
  for (const r of rows) {
    const meta = r.country === "UAE" ? metaById.get(r.invoice_id as string) : undefined;
    const docNo = meta ? docByFirstLease.get(meta.lease_id) : null;
    // Keep only the most recent lease per property, as the report does, so a
    // stray duplicate never bills a property twice.
    const byAsset = new Map<string, VLease>();
    for (const l of docNo ? (leasesByDoc.get(docNo) ?? []) : []) if (l.asset_id) byAsset.set(l.asset_id, l);
    const vLeases = [...byAsset.values()];

    // Billed off a schedule, or not a combined voucher: one bill, as it is.
    if (!meta || meta.schedule_id || vLeases.length === 0) {
      bills.push(whole(r));
      continue;
    }

    // The unpaid proportion of the invoice, applied to each instalment — the
    // same share the Rent Balance shows against that month.
    const invNet = Number(r.net_amount) || 0;
    const invOut = Number(r.net_outstanding) || 0;
    const unpaidRatio = invNet > 0 ? invOut / invNet : 1;

    for (const lease of vLeases) {
      const months = billingMonthStarts(lease.lease_start, lease.lease_end);
      const total = months.length;
      if (total === 0) continue;
      const isHh = lease.lease_type === "hh";
      const monthlyRent = Number(lease.rental_amount) || 0;
      const monthlyShare = round2(monthlyRent * (isHh ? 0.1 : 0.05));
      const fullExpense = expByLease.get(lease.id) ?? 0;

      for (const ch of rentDueChunks(months, lease.payment_terms ?? "monthly")) {
        const rent = round2(monthlyRent * ch.count);
        const share = round2(monthlyShare * ch.count);
        const expense = round2(fullExpense * (ch.count / total));
        const outstanding = round2((rent - share - expense) * unpaidRatio);
        if (outstanding <= 0) continue;
        bills.push({
          key: `${r.invoice_id as string}:${lease.id}:${ch.dueMonth}`,
          invoiceId: r.invoice_id as string,
          country: "UAE",
          accountId: (r.tenant_account_id as string | null) ?? null,
          reference: [r.voucher_no ?? "Draft", r.tenant_name, assetName.get(lease.asset_id as string)]
            .filter(Boolean)
            .join(" · "),
          dueDate: ch.dueMonth,
          billAmount: outstanding,
        });
      }
    }
  }

  // Oldest first, so FIFO settles what fell due earliest.
  bills.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  return bills;
}
