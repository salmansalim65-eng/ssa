import type { ReactNode } from "react";
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
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { Database } from "@/types/database.types";
import { AddCostCenterDialog } from "./add-cost-center-dialog";
import { CostCenterRowActions } from "./cost-center-row-actions";
import type { CostCenterParentOption } from "./cost-center-form";

type CostCenterRow = Database["accounting"]["Tables"]["cost_centers"]["Row"];

const statusLabels: Record<string, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  under_maintenance: "Under maintenance",
  not_applicable: "Not applicable",
};

function collectDescendantIds(
  childrenByParent: Map<string, CostCenterRow[]>,
  rootId: string,
): Set<string> {
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return result;
}

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

  // Build a children-by-parent map for depth-first, indented rendering.
  // Auto-created asset cost centers (parent_id null) fall under the root key.
  const childrenByParent = new Map<string, CostCenterRow[]>();
  for (const cc of rows) {
    const key = cc.parent_id ?? "__root__";
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(cc);
  }
  for (const list of childrenByParent.values())
    list.sort((a, b) => a.code.localeCompare(b.code));

  // Parent picker options: any active cost center may serve as a parent.
  const parentOptions: CostCenterParentOption[] = rows
    .filter((cc) => cc.is_active)
    .map((cc) => ({ id: cc.id, code: cc.code, name: cc.name }));

  function renderRows(parentKey: string, depth: number): ReactNode[] {
    return (childrenByParent.get(parentKey) ?? []).flatMap((cc) => {
      // Exclude the row itself and its descendants so the picker can't create a cycle.
      const excluded = collectDescendantIds(childrenByParent, cc.id);
      excluded.add(cc.id);
      const rowParentOptions = parentOptions.filter((p) => !excluded.has(p.id));

      const row = (
        <TableRow key={cc.id}>
          <TableCell className="font-mono font-medium">{cc.code}</TableCell>
          <TableCell className="font-medium">
            <div
              className="flex items-center"
              style={{ paddingLeft: `${depth * 1.25}rem` }}
            >
              {depth > 0 && (
                <span aria-hidden className="mr-2 text-muted-foreground/60">
                  └
                </span>
              )}
              <span className="truncate">{cc.name}</span>
            </div>
          </TableCell>
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
              parentOptions={rowParentOptions}
              defaultValues={{
                name: cc.name,
                parentId: cc.parent_id ?? "",
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
      );

      return [row, ...renderRows(cc.id, depth + 1)];
    });
  }

  const bodyRows = renderRows("__root__", 0);

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
            <TableBody>{bodyRows}</TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
