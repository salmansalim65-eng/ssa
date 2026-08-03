import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssetImagesManager, type AssetImageItem } from "@/components/assets/asset-images-manager";
import { TitleDeedManager } from "@/components/assets/title-deed-manager";
import { ValuationHistory, type ValuationRow } from "@/components/assets/valuation-history";
import { getSignedUrl } from "@/features/attachments/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { AssetInput } from "@/features/assets/schemas";
import { EditAssetForm } from "./edit-asset-form";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: asset }, canEdit, canCreateValuation, canDeleteValuation] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("*, title_deed:title_deed_attachment_id(id, file_name, path, bucket)")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("assets", "edit"),
    hasPermission("asset_valuations", "create"),
    hasPermission("asset_valuations", "delete"),
  ]);

  if (!asset) notFound();

  const { data: costCenter } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .select("code, name")
    .eq("asset_id", id)
    .maybeSingle();

  const { data: images } = await supabase
    .schema("assets")
    .from("asset_images")
    .select("id, is_primary, attachments:attachment_id(id, file_name, path, bucket)")
    .eq("asset_id", id);

  type RawImage = {
    id: string;
    is_primary: boolean;
    attachments: { id: string; file_name: string; path: string; bucket: string } | null;
  };

  const imageItems: AssetImageItem[] = await Promise.all(
    ((images as unknown as RawImage[]) ?? [])
      .filter((img) => img.attachments)
      .map(async (img) => ({
        id: img.id,
        attachmentId: img.attachments!.id,
        fileName: img.attachments!.file_name,
        isPrimary: img.is_primary,
        url: await getSignedUrl(img.attachments!.bucket, img.attachments!.path),
      })),
  );

  const titleDeed = asset.title_deed as unknown as { id: string; file_name: string; path: string; bucket: string } | null;
  const titleDeedUrl = titleDeed ? await getSignedUrl(titleDeed.bucket, titleDeed.path) : null;

  const { data: valuations } = await supabase
    .schema("assets")
    .from("asset_valuations")
    .select("id, valuation_date, market_value, valuer, notes")
    .eq("asset_id", id)
    .order("valuation_date", { ascending: false });

  const valuationRows: ValuationRow[] = (valuations ?? []).map((v) => ({
    id: v.id,
    valuationDate: v.valuation_date,
    marketValue: v.market_value,
    valuer: v.valuer,
    notes: v.notes,
  }));

  const defaultValues: AssetInput = {
    assetCode: asset.asset_code,
    assetName: asset.asset_name,
    propertyType: asset.property_type,
    country: asset.country,
    city: asset.city ?? "",
    area: asset.area ?? "",
    address: asset.address ?? "",
    purchaseDate: asset.purchase_date ?? "",
    purchaseValue: asset.purchase_value ?? 0,
    currentValue: asset.current_value ?? 0,
    status: asset.status,
    owner: asset.owner ?? "",
    notes: asset.notes ?? "",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{asset.asset_name}</h1>
          <p className="font-mono text-sm text-muted-foreground">{asset.asset_code}</p>
        </div>
        <Badge>{asset.status}</Badge>
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
          <EditAssetForm assetId={asset.id} defaultValues={defaultValues} />
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
