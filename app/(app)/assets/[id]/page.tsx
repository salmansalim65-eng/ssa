import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AssetImagesManager, type AssetImageItem } from "@/components/assets/asset-images-manager";
import { TitleDeedManager } from "@/components/assets/title-deed-manager";
import { ValuationHistory, type ValuationRow } from "@/components/assets/valuation-history";
import { ValueHistory, type ValueHistoryRow } from "@/components/assets/value-history";
import { getSignedUrl } from "@/features/attachments/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { blankAmount } from "@/lib/forms/amount";
import { formatMoney } from "@/lib/format";
import { formatArea } from "@/lib/assets/area-units";
import type { AssetInput } from "@/features/assets/schemas";
import { EditAssetForm } from "./edit-asset-form";
import { DeleteAssetButton } from "./delete-asset-button";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [
    { data: asset },
    canEdit,
    canCreateValuation,
    canDeleteValuation,
    canSell,
    canDelete,
    canAddCountry,
    canDeleteValueHistory,
  ] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("assets", "edit"),
    hasPermission("asset_valuations", "create"),
    hasPermission("asset_valuations", "delete"),
    hasPermission("asset_sales", "create"),
    hasPermission("assets", "delete"),
    hasPermission("countries", "create"),
    hasPermission("asset_value_history", "delete"),
  ]);

  if (!asset) notFound();

  const [
    { data: costCenter },
    { data: companyCurrencies },
    { data: allCostCenters },
    { data: images },
    { data: valuations },
    { data: countries },
    { data: valueHistory },
  ] = await Promise.all([
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("code, name")
      .eq("asset_id", id)
      .maybeSingle(),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currencies:currency_id(id, code, symbol)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, code, name, asset_id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("code"),
    supabase
      .schema("assets")
      .from("asset_images")
      .select("id, is_primary, attachment_id")
      .eq("asset_id", id),
    supabase
      .schema("assets")
      .from("asset_valuations")
      .select("id, valuation_date, market_value, valuer, notes")
      .eq("asset_id", id)
      .order("valuation_date", { ascending: false }),
    supabase
      .schema("core")
      .from("countries")
      .select("code, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .schema("assets")
      .from("asset_value_history")
      .select("id, effective_date, previous_value, new_value, changed_by, remarks")
      .eq("asset_id", id)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  type RawCompanyCurrency = { currencies: { id: string; code: string; symbol: string } | null };
  const currencyRows = ((companyCurrencies as unknown as RawCompanyCurrency[]) ?? []).filter((cc) => cc.currencies);
  const currencyOptions = currencyRows.map((cc) => ({
    id: cc.currencies!.id,
    code: cc.currencies!.code,
    symbol: cc.currencies!.symbol,
  }));
  const assetCurrency = currencyOptions.find((c) => c.id === asset.currency_id) ?? null;
  const currencyLabel = assetCurrency ? assetCurrency.symbol || assetCurrency.code : "";
  const countryName = (countries ?? []).find((c) => c.code === asset.country)?.name ?? asset.country;

  // Exclude this asset's own auto-created 1:1 cost center from the
  // group-cost-center picker — linking it to itself would be meaningless.
  const costCenterOptions = (allCostCenters ?? [])
    .filter((cc) => cc.asset_id !== id)
    .map((cc) => ({ id: cc.id, code: cc.code, name: cc.name }));

  type RawImage = { id: string; is_primary: boolean; attachment_id: string | null };
  const imageRows = (images as unknown as RawImage[]) ?? [];

  // attachments live in the `core` schema (cross-schema from assets); hydrate
  // the title deed and every image attachment in one batched lookup.
  const attachmentsById = await fetchRefs<{ id: string; file_name: string; path: string; bucket: string }>(
    supabase,
    "core",
    "attachments",
    "file_name, path, bucket",
    [asset.title_deed_attachment_id, ...imageRows.map((img) => img.attachment_id)],
  );

  const imageItems: AssetImageItem[] = (
    await Promise.all(
      imageRows.map(async (img) => {
        const att = img.attachment_id ? attachmentsById.get(img.attachment_id) ?? null : null;
        if (!att) return null;
        return {
          id: img.id,
          attachmentId: att.id,
          fileName: att.file_name,
          isPrimary: img.is_primary,
          url: await getSignedUrl(att.bucket, att.path),
        };
      }),
    )
  ).filter((x): x is AssetImageItem => x !== null);

  const titleDeed = asset.title_deed_attachment_id
    ? attachmentsById.get(asset.title_deed_attachment_id) ?? null
    : null;
  const titleDeedUrl = titleDeed ? await getSignedUrl(titleDeed.bucket, titleDeed.path) : null;

  const valuationRows: ValuationRow[] = (valuations ?? []).map((v) => ({
    id: v.id,
    valuationDate: v.valuation_date,
    marketValue: v.market_value,
    valuer: v.valuer,
    notes: v.notes,
  }));

  // Resolve "Changed by" display names for the value history.
  const changedByIds = (valueHistory ?? []).map((h) => h.changed_by).filter(Boolean) as string[];
  const usersById = await fetchRefs<{ id: string; full_name: string }>(
    supabase,
    "core",
    "user_profiles",
    "full_name",
    changedByIds,
  );
  const valueHistoryRows: ValueHistoryRow[] = (valueHistory ?? []).map((h) => ({
    id: h.id,
    effectiveDate: h.effective_date,
    previousValue: h.previous_value,
    newValue: h.new_value,
    changedBy: h.changed_by ? usersById.get(h.changed_by)?.full_name ?? null : null,
    remarks: h.remarks,
  }));

  const today = new Date().toISOString().slice(0, 10);

  const defaultValues: AssetInput = {
    assetName: asset.asset_name,
    propertyType: asset.property_type,
    country: asset.country,
    city: asset.city ?? "",
    area: asset.area ?? "",
    areaSqft: asset.area_sqft ?? blankAmount,
    areaUnit: asset.area_unit ?? "",
    address: asset.address ?? "",
    purchaseDate: asset.purchase_date ?? "",
    purchaseValue: asset.purchase_value ?? blankAmount,
    currentValue: asset.current_value ?? blankAmount,
    currencyId: asset.currency_id ?? "",
    serviceChargesRate: asset.service_charges_rate ?? blankAmount,
    titleDeedValue: asset.title_deed_value ?? blankAmount,
    otherCharges: asset.other_charges ?? blankAmount,
    estimatedRent: asset.estimated_rent ?? blankAmount,
    status: asset.status,
    owner: asset.owner ?? "",
    officialOwner: asset.official_owner ?? "",
    groupCostCenterId: asset.group_cost_center_id ?? "",
    notes: asset.notes ?? "",
    valueEffectiveDate: today,
    valueRemarks: "",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Asset · ${asset.asset_code}`}
        title={asset.asset_name}
        backHref="/assets"
        actions={
          <>
            <Badge className="capitalize">{asset.status}</Badge>
            {canSell && asset.status === "active" && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/sales/new?assetId=${asset.id}`}>Sell asset</Link>
              </Button>
            )}
            {canDelete && <DeleteAssetButton assetId={asset.id} assetName={asset.asset_name} />}
          </>
        }
      />

      {costCenter && (
        <p className="text-sm text-muted-foreground">
          Linked cost center: <span className="font-mono">{costCenter.code}</span> — {costCenter.name}
        </p>
      )}

      {/* Quick-read summary with a prominent Total Property Value. */}
      <Card>
        <CardHeader>
          <CardTitle>Property summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Country</dt>
              <dd className="font-medium">{countryName}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Official owner</dt>
              <dd className="font-medium">{asset.official_owner ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Property type</dt>
              <dd className="font-medium">{asset.property_type}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Area</dt>
              <dd className="font-medium">{formatArea(asset.area_sqft, asset.area_unit)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Current value</dt>
              <dd className="font-mono font-medium tabular-nums">
                {asset.current_value != null ? `${currencyLabel ? `${currencyLabel} ` : ""}${formatMoney(asset.current_value)}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Title deed value</dt>
              <dd className="font-mono font-medium tabular-nums">
                {asset.title_deed_value != null ? `${currencyLabel ? `${currencyLabel} ` : ""}${formatMoney(asset.title_deed_value)}` : "—"}
              </dd>
            </div>
          </dl>
          <div className="flex items-center justify-between rounded-lg border-2 border-ledger/40 bg-ledger/10 px-4 py-3">
            <span className="text-sm font-semibold uppercase tracking-wide text-ledger">Total property value</span>
            <span className="font-mono text-xl font-bold tabular-nums text-foreground">
              {currencyLabel ? `${currencyLabel} ` : ""}
              {formatMoney(asset.total_property_value)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditAssetForm
            assetId={asset.id}
            defaultValues={defaultValues}
            currencies={currencyOptions}
            costCenters={costCenterOptions}
            countries={countries ?? []}
            canAddCountry={canAddCountry}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Value history</CardTitle>
        </CardHeader>
        <CardContent>
          <ValueHistory
            assetId={asset.id}
            rows={valueHistoryRows}
            canDelete={canDeleteValueHistory}
            currencyLabel={currencyLabel}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Property images</CardTitle>
        </CardHeader>
        <CardContent>
          <AssetImagesManager assetId={asset.id} images={imageItems} canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Title deed</CardTitle>
        </CardHeader>
        <CardContent>
          <TitleDeedManager
            assetId={asset.id}
            fileName={titleDeed?.file_name ?? null}
            url={titleDeedUrl}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Valuation history</CardTitle>
        </CardHeader>
        <CardContent>
          <ValuationHistory
            assetId={asset.id}
            valuations={valuationRows}
            canEdit={canCreateValuation}
            canDelete={canDeleteValuation}
          />
        </CardContent>
      </Card>
    </div>
  );
}
