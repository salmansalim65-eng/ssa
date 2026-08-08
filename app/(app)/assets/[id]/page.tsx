import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssetImagesManager, type AssetImageItem } from "@/components/assets/asset-images-manager";
import { TitleDeedManager } from "@/components/assets/title-deed-manager";
import { ValuationHistory, type ValuationRow } from "@/components/assets/valuation-history";
import { getSignedUrl } from "@/features/attachments/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { AssetInput } from "@/features/assets/schemas";
import { EditAssetForm } from "./edit-asset-form";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: asset }, canEdit, canCreateValuation, canDeleteValuation, canSell] = await Promise.all([
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
  ]);

  if (!asset) notFound();

  const [
    { data: costCenter },
    { data: companyCurrencies },
    { data: allCostCenters },
    { data: images },
    { data: valuations },
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
      .select("currencies:currency_id(id, code)")
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
  ]);

  type RawCompanyCurrency = { currencies: { id: string; code: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCompanyCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

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

  const defaultValues: AssetInput = {
    assetName: asset.asset_name,
    propertyType: asset.property_type,
    country: asset.country,
    city: asset.city ?? "",
    area: asset.area ?? "",
    areaSqft: asset.area_sqft ?? 0,
    address: asset.address ?? "",
    purchaseDate: asset.purchase_date ?? "",
    purchaseValue: asset.purchase_value ?? 0,
    currentValue: asset.current_value ?? 0,
    currencyId: asset.currency_id ?? "",
    serviceChargesRate: asset.service_charges_rate ?? 0,
    titleDeedValue: asset.title_deed_value ?? 0,
    estimatedRent: asset.estimated_rent ?? 0,
    status: asset.status,
    owner: asset.owner ?? "",
    groupCostCenterId: asset.group_cost_center_id ?? "",
    notes: asset.notes ?? "",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Asset · <span className="font-mono">{asset.asset_code}</span>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{asset.asset_name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="capitalize">{asset.status}</Badge>
          {canSell && asset.status === "active" && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/sales/new?assetId=${asset.id}`}>Sell asset</Link>
            </Button>
          )}
        </div>
      </div>

      {costCenter && (
        <p className="text-sm text-muted-foreground">
          Linked cost center: <span className="font-mono">{costCenter.code}</span> — {costCenter.name}
        </p>
      )}

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
