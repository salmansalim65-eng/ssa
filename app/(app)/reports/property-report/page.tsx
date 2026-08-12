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
  ] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select(
        "id, asset_code, asset_name, country, area_sqft, purchase_value, current_value, service_charges_rate, service_charges_amount, title_deed_value, estimated_rent, owner, official_owner, purchase_date, property_type, title_deed_attachment_id",
      )
      .eq("company_id", companyId)
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
      .select("asset_id, rental_amount, rent_cycle, lease_start, lease_end, rent_month")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    supabase
      .schema("rental")
      .from("pk_leases")
      .select("asset_id, monthly_rent, rent_cycle, lease_start, lease_end, rent_month")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    supabase.schema("assets").from("asset_valuations").select("asset_id, valuation_date").is("deleted_at", null),
    supabase.schema("assets").from("asset_images").select("asset_id, attachment_id, is_primary"),
    supabase.schema("core").from("countries").select("code, name").eq("company_id", companyId),
    supabase.schema("rental").from("uae_rent_invoices").select("invoice_date, amount").eq("company_id", companyId),
    supabase.schema("rental").from("pk_rent_invoices").select("invoice_date, total_amount").eq("company_id", companyId),
  ]);

  const countryName = new Map((countryRows ?? []).map((c) => [c.code as string, c.name as string]));

  // Cost centres by asset id (for the cost-centre name shown per property).
  const ccByAsset = new Map(
    (costCenters ?? []).filter((c) => c.asset_id).map((c) => [c.asset_id as string, c]),
  );

  // Active lease per asset (today within period, or any lease when dates are open).
  interface ActiveLease {
    monthly: number;
    start: string | null;
    end: string | null;
    renew: string | null;
  }
  const leaseByAsset = new Map<string, ActiveLease>();
  const consider = (
    assetId: string | null,
    amount: number,
    cycle: string | null,
    start: string | null,
    end: string | null,
    rentMonth: string | null,
  ) => {
    if (!assetId) return;
    const active = (!start || start <= today) && (!end || end >= today);
    if (!active && leaseByAsset.has(assetId)) return;
    leaseByAsset.set(assetId, {
      monthly: monthlyFromCycle(amount, cycle),
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
    );
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
    return computePropertyRow({
      id,
      group: countryCode ? countryName.get(countryCode) ?? countryCode : UNSPECIFIED,
      name: (ccByAsset.get(id)?.name as string) ?? (a.asset_name as string),
      assetCode: a.asset_code as string,
      country: countryCode,
      propertyType: (a.property_type as string) ?? "",
      estimatedRentMonthly: Number(a.estimated_rent) || 0,
      monthlyRent: lease?.monthly ?? 0,
      areaSqft: Number(a.area_sqft) || 0,
      serviceRate: Number(a.service_charges_rate) || 0,
      serviceCharges: Number(a.service_charges_amount) || 0,
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

  // Group rows by country, ordered alphabetically with Unspecified last.
  const byGroup = new Map<string, PropertyRow[]>();
  for (const r of rows) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group)!.push(r);
  }
  const groups: PropertyGroup[] = [...byGroup.entries()]
    .sort((a, b) => (a[0] === UNSPECIFIED ? 1 : b[0] === UNSPECIFIED ? -1 : a[0].localeCompare(b[0])))
    .map(([name, groupRows]) => ({
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
      totalCostCenters={rows.length}
      totalProperties={(assets ?? []).length}
      monthlyTrend={monthlyTrend}
    />
  );
}
