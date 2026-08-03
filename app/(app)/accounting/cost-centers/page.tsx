import { Badge } from "@/components/ui/badge";
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cost Centers</h1>
          <p className="text-sm text-muted-foreground">
            One cost center per registered asset. Linking to the asset itself
            happens once Asset Registration (Phase 6) ships.
          </p>
        </div>
        {canCreate && <AddCostCenterDialog />}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
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
          {(costCenters ?? []).map((cc) => (
            <TableRow key={cc.id}>
              <TableCell className="font-mono font-medium">{cc.code}</TableCell>
              <TableCell>{cc.name}</TableCell>
              <TableCell>{[cc.country, cc.city].filter(Boolean).join(" / ") || "—"}</TableCell>
              <TableCell>{cc.property_type || "—"}</TableCell>
              <TableCell>{cc.owner || "—"}</TableCell>
              <TableCell>
                <Badge variant="outline">{statusLabels[cc.rental_status]}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={cc.is_active ? "success" : "secondary"}>
                  {cc.is_active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <CostCenterRowActions
                  costCenterId={cc.id}
                  isActive={cc.is_active}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  defaultValues={{
                    code: cc.code,
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
          {(costCenters ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                No cost centers yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
