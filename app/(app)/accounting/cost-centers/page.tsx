import { LandmarkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { AddCostCenterDialog } from "./add-cost-center-dialog";
import { CostCenterRowActions } from "./cost-center-row-actions";

const statusLabels: Record<string, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  under_maintenance: "Under maintenance",
  not_applicable: "Not applicable",
};

export default async function CostCentersPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

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

  const rows = costCenters ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Cost Centers"
        description="Track one cost center per registered asset to tag transactions and drive property-level reporting."
        actions={canCreate && <AddCostCenterDialog />}
      />

      <div className="rounded-xl border bg-card shadow-sm">
        {rows.length === 0 ? (
          <EmptyState
            icon={LandmarkIcon}
            title="No cost centers yet"
            description="Cost centers let you attribute income and costs to individual properties."
            action={canCreate && <AddCostCenterDialog />}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Country / City</TableHead>
                <TableHead>Property type</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((cc) => (
                <TableRow key={cc.id}>
                  <TableCell className="font-mono font-medium">{cc.code}</TableCell>
                  <TableCell className="font-medium">{cc.name}</TableCell>
                  <TableCell>{[cc.country, cc.city].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell>{cc.property_type || "—"}</TableCell>
                  <TableCell>{cc.owner || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{statusLabels[cc.rental_status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge active={cc.is_active} />
                  </TableCell>
                  <TableCell>
                    <CostCenterRowActions
                      costCenterId={cc.id}
                      isActive={cc.is_active}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      defaultValues={{
                        name: cc.name,
                        country: cc.country ?? "",
                        city: cc.city ?? "",
                        propertyType: cc.property_type ?? "",
                        building: cc.building ?? "",
                        plotNumber: cc.plot_number ?? "",
                        owner: cc.owner ?? "",
                        rentalStatus: cc.rental_status,
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
