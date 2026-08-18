import { LandmarkIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { Database } from "@/types/database.types";
import { AddCostCenterDialog } from "./add-cost-center-dialog";
import { CostCentersTree } from "./cost-centers-tree";
import type { CostCenterParentOption } from "./cost-center-form";

type CostCenterRow = Database["accounting"]["Tables"]["cost_centers"]["Row"];

export default async function CostCentersPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: costCenters }, canCreate, canEdit, canDelete] = await Promise.all([
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("code"),
    hasPermission("cost_centers", "create"),
    hasPermission("cost_centers", "edit"),
    hasPermission("cost_centers", "delete"),
  ]);

  const rows: CostCenterRow[] = costCenters ?? [];

  // Parent picker options: any active cost center may serve as a parent.
  const parentOptions: CostCenterParentOption[] = rows
    .filter((cc) => cc.is_active)
    .map((cc) => ({ id: cc.id, code: cc.code, name: cc.name }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Cost Centers"
        description="Track one cost center per registered asset to tag transactions and drive property-level reporting."
        actions={canCreate && <AddCostCenterDialog parentOptions={parentOptions} />}
      />

      <div className="rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={LandmarkIcon}
            title="No cost centers yet"
            description="Cost centers let you attribute income and costs to individual properties."
            action={canCreate && <AddCostCenterDialog parentOptions={parentOptions} />}
          />
        ) : (
          <CostCentersTree
            rows={rows}
            canEdit={canEdit}
            canDelete={canDelete}
            parentOptions={parentOptions}
          />
        )}
      </div>
    </div>
  );
}
