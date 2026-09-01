"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatVoucherNo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database.types";
import { CostCenterRowActions } from "./cost-center-row-actions";
import type { CostCenterParentOption } from "./cost-center-form";

type CostCenterRow = Database["accounting"]["Tables"]["cost_centers"]["Row"];

const statusLabels: Record<string, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  under_maintenance: "Under maintenance",
  not_applicable: "Not applicable",
};

function collectDescendantIds(childrenByParent: Map<string, CostCenterRow[]>, rootId: string): Set<string> {
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

export function CostCentersTree({
  rows,
  canEdit,
  canDelete,
  canEditGroup,
  canDeleteGroup,
  parentOptions,
}: {
  rows: CostCenterRow[];
  canEdit: boolean;
  canDelete: boolean;
  /** Group cost centres organise the tree, so they carry their own permissions. */
  canEditGroup: boolean;
  canDeleteGroup: boolean;
  parentOptions: CostCenterParentOption[];
}) {
  // Group cost centres (PROPERTIES, DUBAI PROPERTIES, …) start expanded; clicking
  // a group toggles whether its children are shown.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const childrenByParent = useMemo(() => {
    const map = new Map<string, CostCenterRow[]>();
    for (const cc of rows) {
      const key = cc.parent_id ?? "__root__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(cc);
    }
    for (const list of map.values()) list.sort((a, b) => a.code.localeCompare(b.code));
    return map;
  }, [rows]);

  // Serial number for actual cost centres (leaf rows), assigned in full tree
  // order so numbers stay stable when a group is collapsed. Group rows are not
  // numbered.
  const serialById = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    const walk = (parentKey: string) => {
      for (const cc of childrenByParent.get(parentKey) ?? []) {
        if (!cc.is_group) {
          n += 1;
          map.set(cc.id, n);
        }
        walk(cc.id);
      }
    };
    walk("__root__");
    return map;
  }, [childrenByParent]);

  function renderRows(parentKey: string, depth: number): ReactNode[] {
    return (childrenByParent.get(parentKey) ?? []).flatMap((cc) => {
      const excluded = collectDescendantIds(childrenByParent, cc.id);
      excluded.add(cc.id);
      const rowParentOptions = parentOptions.filter((p) => !excluded.has(p.id));
      const isGroup = Boolean(cc.is_group);
      const hasChildren = (childrenByParent.get(cc.id) ?? []).length > 0;
      const isCollapsed = collapsed.has(cc.id);

      const row = (
        <TableRow
          key={cc.id}
          className={cn(isGroup && "bg-ledger/15 hover:bg-ledger/20 dark:bg-ledger/10")}
        >
          <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
            {isGroup ? "" : serialById.get(cc.id)}
          </TableCell>
          <TableCell className="font-mono font-medium">{formatVoucherNo(cc.code)}</TableCell>
          <TableCell className={cn("font-medium", isGroup && "font-semibold text-ledger-dark")}>
            <div className="flex items-center" style={{ paddingLeft: `${depth * 1.25}rem` }}>
              {isGroup && hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggle(cc.id)}
                  aria-label={isCollapsed ? "Expand group" : "Collapse group"}
                  className="mr-1.5 inline-flex size-5 items-center justify-center rounded text-ledger-dark transition-colors hover:bg-ledger/25"
                >
                  {isCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
                </button>
              ) : (
                depth > 0 && (
                  <span aria-hidden className="mr-2 text-muted-foreground/60">
                    └
                  </span>
                )
              )}
              <span className="truncate">{cc.name}</span>
              {isGroup && hasChildren && (
                <span className="ml-2 rounded bg-ledger/25 px-1.5 text-[0.7rem] font-medium text-ledger-dark">
                  {(childrenByParent.get(cc.id) ?? []).length}
                </span>
              )}
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
              canEdit={isGroup ? canEditGroup : canEdit}
              canDelete={isGroup ? canDeleteGroup : canDelete}
              canManageGroups={canEditGroup}
              parentOptions={rowParentOptions}
              defaultValues={{
                name: cc.name,
                isGroup: cc.is_group ?? false,
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

      // Hide descendants of a collapsed group.
      if (isGroup && isCollapsed) return [row];
      return [row, ...renderRows(cc.id, depth + 1)];
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-12 text-right">S.No</TableHead>
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
      <TableBody>{renderRows("__root__", 0)}</TableBody>
    </Table>
  );
}
