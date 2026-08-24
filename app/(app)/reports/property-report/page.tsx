import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import {
  aggregateGroup,
  computePropertyRow,
  monthlyFromCycle,
  type PropertyRow,
} from "@/lib/reports/property-report";
import { PropertyReportView, type PropertyGroup } from "@/components/reports/property-report-view";

const UNSPECIFIED = "Unspecified";

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const y = Number(String(date).slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : null;
}

function monthLabel(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", { month: "long" });
}

export default async function PropertyReportPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: assets },
    { data: costCenters },
    { data: uaeLeases },
    { data: pkLeases },
    { data: valuations },
    { data: images },
    { data: countryRows },
    { data: uaeInvoices },
    { data: pkInvoices },
    { data: currencyRows },
    { data: companyCurrencies },
    { data: exchangeRates },
    { data: leaseExpenses },
  ] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select(
        "id, asset_code, asset_name, country, currency_id, area_sqft, purchase_value, current_value, service_charges_rate, service_charges_amount, property_tax, title_deed_value, estimated_rent, owner, official_owner, purchase_date, property_type, title_deed_attachment_id",
      )
      .eq("company_id", companyId)
      .eq("is_rental", true)
      .is("deleted_at", null)
      .order("asset_code"),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, code, name, asset_id")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("id, asset_id, rental_amount, rent_cycle, lease_start, lease_end, rent_month, lease_type")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    supabase
      .schema("rental")
      .from("pk_leases")
      .select("asset_id, monthly_rent, official_rent, rent_cycle, lease_start, lease_end, rent_month")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    supabase.schema("assets").from("asset_valuations").select("asset_id, valuation_date").is("deleted_at", null),
    supabase.schema("assets").from("asset_images").select("asset_id, attachment_id, is_primary"),
    supabase.schema("core").from("countries").select("code, name").eq("company_id", companyId),
    supabase.schema("rental").from("uae_rent_invoices").select("invoice_date, amount").eq("company_id", companyId),
    supabase.schema("rental").from("pk_rent_invoices").select("invoice_date, total_amount").eq("company_id", companyId),
    supabase.schema("core").from("currencies").select("id, code, symbol"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currency_id, is_base_currency, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("core")
      .from("exchange_rates")
      .select("currency_id, rate_to_base, rate_date")
      .eq("company_id", companyId)
      .lte("rate_date", today)
      .order("rate_date", { ascending: false }),
    supabase.schema("rental").from("lease_expenses").select("lease_id, amount").eq("company_id", companyId),
  ]);

  // Monthly HH-lease expense total per lease — deducted from Net Rent.
  const expenseByLease = new Map<string, number>();
  for (const e of leaseExpenses ?? []) {
    const k = e.lease_id as string;
    expenseByLease.set(k, (expenseByLease.get(k) ?? 0) + Number(e.amount));
  }

  const countryName = new Map((countryRows ?? []).map((c) => [c.code as string, c.name as string]));

  // Currency plumbing: resolve each property's currency, build a base-rate map
  // for optional conversion, and the list of currencies the report can display.
  const currencyById = new Map(
    (currencyRows ?? []).map((c) => [c.id as string, { code: c.code as string, symbol: c.symbol as string }]),
  );
  const currencyIdByCode = new Map((currencyRows ?? []).map((c) => [c.code as string, c.id as string]));
  // Fallback currency by country when an asset has no explicit currency_id.
  const currencyIdByCountry = (code: string): string | null => {
    const map: Record<string, string> = { PK: "PKR", AE: "AED", SA: "SAR" };
    const cur = map[code];
    return cur ? currencyIdByCode.get(cur) ?? null : null;
  };
  const baseCurrencyId = ((companyCurrencies ?? []).find((c) => c.is_base_currency)?.currency_id as string) ?? null;
  // rate_to_base per currency (base = 1); latest row wins (already ordered desc).
  const rateToBase: Record<string, number> = {};
  if (baseCurrencyId) rateToBase[baseCurrencyId] = 1;
  for (const r of exchangeRates ?? []) {
    const id = r.currency_id as string;
    if (!(id in rateToBase)) rateToBase[id] = Number(r.rate_to_base) || 0;
  }
  // Currencies the report can convert to: active company currencies that have a
  // usable rate (or are the base currency).
  const currencyOptions = (companyCurrencies ?? [])
    .map((c) => c.currency_id as string)
    .filter((id) => id in rateToBase && (rateToBase[id] ?? 0) > 0)
    .map((id) => ({ id, code: currencyById.get(id)?.code ?? id, symbol: currencyById.get(id)?.symbol ?? "" }))
    .sort((a, b) => a.code.localeCompare(b.code));

  // Cost centres by asset id (for the cost-centre name shown per property).
  const ccByAsset = new Map(
    (costCenters ?? []).filter((c) => c.asset_id).map((c) => [c.asset_id as string, c]),
  );

  // Active lease per asset (today within period, or any lease when dates are open).
  interface ActiveLease {
    active: boolean;
    monthly: number;
    commissionMonthly: number; // agent commission (5% UAE / 10% HH / 0 PK)
    expensesMonthly: number; // monthly HH lease expenses (deducted from net rent)
    start: string | null;
    end: string | null;
    renew: string | null;
  }
  // A property can carry more than one active lease (e.g. separate units under
  // one property, like SAIMA's B-601 / B-614). Sum every concurrent active
  // lease's rent so the Property Report matches the Rent Report, instead of the
  // last-seen lease silently overwriting the others.
  const leaseByAsset = new Map<string, ActiveLease>();
  const consider = (
    assetId: string | null,
    amount: number,
    cycle: string | null,
    start: string | null,
    end: string | null,
    rentMonth: string | null,
    commissionPct: number,
    expensesMonthly: number,
  ) => {
    if (!assetId) return;
    const active = (!start || start <= today) && (!end || end >= today);
    const monthly = monthlyFromCycle(amount, cycle);
    const commissionMonthly = Math.round(monthly * commissionPct * 100) / 100;
    const existing = leaseByAsset.get(assetId);

    if (existing) {
      // Sum additional concurrent active leases onto the running total.
      if (active && existing.active) {
        existing.monthly += monthly;
        existing.commissionMonthly += commissionMonthly;
        existing.expensesMonthly += expensesMonthly;
        return;
      }
      // An active lease supersedes an inactive placeholder; otherwise keep what
      // is already recorded (an inactive lease never overrides an active one).
      if (active && !existing.active) {
        leaseByAsset.set(assetId, {
          active: true,
          monthly,
          commissionMonthly,
          expensesMonthly,
          start,
          end,
          renew: rentMonth || monthLabel(end),
        });
      }
      return;
    }

    leaseByAsset.set(assetId, {
      active,
      monthly,
      commissionMonthly,
      expensesMonthly,
      start,
      end,
      renew: rentMonth || monthLabel(end),
    });
  };
  for (const l of uaeLeases ?? []) {
    consider(
      l.asset_id as string | null,
      Number(l.rental_amount),
      l.rent_cycle as string | null,
      l.lease_start as string | null,
      l.lease_end as string | null,
      l.rent_month as string | null,
      // Agent commission: HH lease 10%, standard UAE lease 5% (see lib/rental/lease-accounting.ts).
      l.lease_type === "hh" ? 0.1 : 0.05,
      l.lease_type === "hh" ? expenseByLease.get(l.id as string) ?? 0 : 0,
    );
  }
  for (const l of pkLeases ?? []) {
    consider(
      l.asset_id as string | null,
      Number(l.monthly_rent),
      l.rent_cycle as string | null,
      l.lease_start as string | null,
      l.lease_end as string | null,
      l.rent_month as string | null,
      0, // no agent commission on PK leases
      0, // no HH expenses on PK leases
    );
  }

  // Official (declared) rent per PK asset — monthly, summed over concurrent
  // active leases and normalised by cycle. Pakistan-only.
  const officialRentMonthlyByAsset = new Map<string, number>();
  for (const l of pkLeases ?? []) {
    const assetId = l.asset_id as string | null;
    if (!assetId) continue;
    const start = l.lease_start as string | null;
    const end = l.lease_end as string | null;
    const active = (!start || start <= today) && (!end || end >= today);
    if (!active) continue;
    const m = monthlyFromCycle(Number(l.official_rent) || 0, l.rent_cycle as string | null);
    officialRentMonthlyByAsset.set(assetId, (officialRentMonthlyByAsset.get(assetId) ?? 0) + m);
  }

  // Latest valuation year per asset.
  const valYearByAsset = new Map<string, number>();
  for (const v of valuations ?? []) {
    const y = yearOf(v.valuation_date as string | null);
    const k = v.asset_id as string;
    if (y && (!valYearByAsset.has(k) || y > valYearByAsset.get(k)!)) valYearByAsset.set(k, y);
  }

  // Hydrate image + title-deed attachments (they live in the core schema) and
  // sign their storage paths so the detail panel can render real thumbnails.
  const imageRows = (images ?? []) as {
    asset_id: string;
    attachment_id: string | null;
    is_primary: boolean;
  }[];
  const attachmentsById = await fetchRefs<{
    id: string;
    file_name: string;
    path: string;
    bucket: string;
  }>(
    supabase,
    "core",
    "attachments",
    "file_name, path, bucket",
    [
      ...imageRows.map((r) => r.attachment_id),
      ...(assets ?? []).map((a) => a.title_deed_attachment_id as string | null),
    ],
  );

  // Batch-sign every referenced path, grouped per storage bucket (1h expiry).
  const pathsByBucket = new Map<string, Set<string>>();
  for (const att of attachmentsById.values()) {
    if (!pathsByBucket.has(att.bucket)) pathsByBucket.set(att.bucket, new Set());
    pathsByBucket.get(att.bucket)!.add(att.path);
  }
  const urlByPath = new Map<string, string>();
  await Promise.all(
    [...pathsByBucket.entries()].map(async ([bucket, paths]) => {
      const { data } = await supabase.storage.from(bucket).createSignedUrls([...paths], 60 * 60);
      for (const row of data ?? []) {
        if (row.signedUrl && row.path) urlByPath.set(row.path, row.signedUrl);
      }
    }),
  );
  const signedUrlFor = (attId: string | null | undefined): string | null => {
    if (!attId) return null;
    const att = attachmentsById.get(attId);
    return att ? urlByPath.get(att.path) ?? null : null;
  };

  // Images per asset, primary first, with any signed URLs resolved.
  const imagesByAsset = new Map<string, { url: string; fileName: string }[]>();
  const imageCountByAsset = new Map<string, number>();
  for (const r of imageRows) {
    imageCountByAsset.set(r.asset_id, (imageCountByAsset.get(r.asset_id) ?? 0) + 1);
    const url = signedUrlFor(r.attachment_id);
    if (!url) continue;
    const att = r.attachment_id ? attachmentsById.get(r.attachment_id) : null;
    const list = imagesByAsset.get(r.asset_id) ?? [];
    const item = { url, fileName: att?.file_name ?? "image" };
    if (r.is_primary) list.unshift(item);
    else list.push(item);
    imagesByAsset.set(r.asset_id, list);
  }

  const rows: PropertyRow[] = (assets ?? []).map((a) => {
    const id = a.id as string;
    const lease = leaseByAsset.get(id);
    const countryCode = (a.country as string) ?? "";
    const curId = ((a.currency_id as string) ?? null) || currencyIdByCountry(countryCode);
    return computePropertyRow({
      id,
      group: countryCode ? countryName.get(countryCode) ?? countryCode : UNSPECIFIED,
      name: (ccByAsset.get(id)?.name as string) ?? (a.asset_name as string),
      assetCode: a.asset_code as string,
      country: countryCode,
      propertyType: (a.property_type as string) ?? "",
      currencyId: curId,
      currencyCode: curId ? currencyById.get(curId)?.code ?? "" : "",
      estimatedRentMonthly: Number(a.estimated_rent) || 0,
      monthlyRent: lease?.monthly ?? 0,
      areaSqft: Number(a.area_sqft) || 0,
      serviceRate: Number(a.service_charges_rate) || 0,
      serviceCharges: Number(a.service_charges_amount) || 0,
      officialRentYearly: (officialRentMonthlyByAsset.get(id) ?? 0) * 12,
      propertyTax: Number(a.property_tax) || 0,
      commissionMonthly: lease?.commissionMonthly ?? 0,
      expensesMonthly: lease?.expensesMonthly ?? 0,
      purchaseValue: Number(a.purchase_value) || 0,
      currentValue: Number(a.current_value) || 0,
      titleDeedValue: Number(a.title_deed_value) || 0,
      titleDeedOwner: (a.official_owner as string) || (a.owner as string) || "",
      occupied: Boolean(lease),
      purchaseDate: (a.purchase_date as string) ?? null,
      valuationYear: valYearByAsset.get(id) ?? yearOf(a.purchase_date as string | null),
      leaseStart: lease?.start ?? null,
      leaseEnd: lease?.end ?? null,
      renewMonth: lease?.renew ?? null,
      titleDeedAttachmentId: (a.title_deed_attachment_id as string) ?? null,
      titleDeedUrl: signedUrlFor(a.title_deed_attachment_id as string | null),
      imageCount: imageCountByAsset.get(id) ?? 0,
      images: imagesByAsset.get(id) ?? [],
    });
  });

  // Group rows by country: UAE first, then Pakistan, then any other country
  // alphabetically, with Unspecified always last.
  const byGroup = new Map<string, PropertyRow[]>();
  for (const r of rows) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group)!.push(r);
  }
  const countryRank = (name: string, code: string) =>
    name === UNSPECIFIED ? 3 : code === "AE" ? 0 : code === "PK" ? 1 : 2;
  const groups: PropertyGroup[] = [...byGroup.entries()]
    .map(([name, groupRows]) => ({ name, groupRows, code: groupRows[0]?.country ?? "" }))
    .sort((a, b) => {
      const ra = countryRank(a.name, a.code);
      const rb = countryRank(b.name, b.code);
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    })
    .map(({ name, groupRows }) => ({
      name,
      totals: aggregateGroup(groupRows),
      rows: groupRows.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  const countries = [...new Set(rows.map((r) => r.country).filter(Boolean))]
    .map((code) => ({ code, name: countryName.get(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Monthly rental-income trend: aggregate posted lease invoices over the last
  // 12 months (UAE + PK) into a real time series for the trend line chart.
  const now = new Date(`${today}T00:00:00`);
  const monthKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const monthTotals = new Map(monthKeys.map((k) => [k, 0]));
  const addInvoice = (date: unknown, amount: unknown) => {
    const k = String(date ?? "").slice(0, 7);
    if (monthTotals.has(k)) monthTotals.set(k, monthTotals.get(k)! + (Number(amount) || 0));
  };
  for (const inv of uaeInvoices ?? []) addInvoice(inv.invoice_date, inv.amount);
  for (const inv of pkInvoices ?? []) addInvoice(inv.invoice_date, inv.total_amount);
  const monthlyTrend = monthKeys.map((k) => ({
    month: k,
    label: new Date(`${k}-01T00:00:00`).toLocaleString("en-GB", { month: "short" }),
    total: Math.round(monthTotals.get(k) ?? 0),
  }));

  return (
    <PropertyReportView
      groups={groups}
      countries={countries}
      monthlyTrend={monthlyTrend}
      currencies={currencyOptions}
      rateToBase={rateToBase}
      baseCurrencyId={baseCurrencyId}
    />
  );
}
