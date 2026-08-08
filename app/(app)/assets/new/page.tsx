import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { NewAssetForm } from "./new-asset-form";

export default async function NewAssetPage() {
  const canCreate = await hasPermission("assets", "create");
  if (!canCreate) redirect("/assets");

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: companyCurrencies }, { data: costCenters }] = await Promise.all([
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, code, name")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("code"),
  ]);

  type RawCompanyCurrency = { currencies: { id: string; code: string } | null };
  const currencyOptions = ((companyCurrencies as unknown as RawCompanyCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="New Asset"
        description="Register a rental property or other asset."
        actions={
          <Button asChild variant="outline">
            <Link href="/assets">
              <ArrowLeftIcon /> Back to register
            </Link>
          </Button>
        }
      />
      <NewAssetForm currencies={currencyOptions} costCenters={costCenters ?? []} />
    </div>
  );
}
