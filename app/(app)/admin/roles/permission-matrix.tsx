"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setRolePermission } from "@/features/admin/roles/actions";
import type { PermissionAction } from "@/types/database.types";

const ACTIONS: PermissionAction[] = [
  "view",
  "create",
  "edit",
  "delete",
  "print",
  "export",
  "approve",
  "reject",
  "post",
];

export interface PermissionRow {
  id: string;
  module_key: string;
  action: PermissionAction;
}

// A few module keys read better with a hand-written label than title-casing the
// key. Kept minimal — the key itself stays stable for grants/RLS.
const MODULE_LABEL_OVERRIDES: Record<string, string> = {
  jv_maintenance_voucher: "JV Service Charges",
};

function moduleLabel(moduleKey: string) {
  return (
    MODULE_LABEL_OVERRIDES[moduleKey] ??
    moduleKey
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export function PermissionMatrix({
  roleId,
  permissions,
  initialGrants,
  canEdit,
}: {
  roleId: string;
  permissions: PermissionRow[];
  initialGrants: Record<string, boolean>;
  canEdit: boolean;
}) {
  const [grants, setGrants] = useState(initialGrants);
  const [, startTransition] = useTransition();

  const moduleKeys = useMemo(
    () => Array.from(new Set(permissions.map((p) => p.module_key))).sort(),
    [permissions],
  );

  const permissionByModuleAction = useMemo(() => {
    const map = new Map<string, PermissionRow>();
    for (const p of permissions) map.set(`${p.module_key}:${p.action}`, p);
    return map;
  }, [permissions]);

  function toggle(permission: PermissionRow, checked: boolean) {
    setGrants((prev) => ({ ...prev, [permission.id]: checked }));
    startTransition(async () => {
      const result = await setRolePermission(roleId, permission.id, checked);
      if (result?.error) {
        toast.error(result.error);
        setGrants((prev) => ({ ...prev, [permission.id]: !checked }));
      }
    });
  }

  return (
    <div className="rounded-md border">
      {/* The height and the scrolling belong to the table's own container, so
          the sticky header row has something to stick to. */}
      <Table containerClassName="max-h-[70vh] overflow-auto">
        <TableHeader className="sticky top-0 z-20">
          <TableRow>
            {/* z-30: the corner cell is frozen both ways, so it has to sit above
                the rest of the header row and above the frozen first column. */}
            <TableHead className="sticky left-0 z-30 bg-header">Module</TableHead>
            {ACTIONS.map((action) => (
              <TableHead key={action} className="bg-header text-center capitalize">
                {action}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {moduleKeys.map((moduleKey) => (
            <TableRow key={moduleKey}>
              <TableCell className="sticky left-0 bg-background font-medium">
                {moduleLabel(moduleKey)}
              </TableCell>
              {ACTIONS.map((action) => {
                const permission = permissionByModuleAction.get(`${moduleKey}:${action}`);
                if (!permission) return <TableCell key={action} />;
                return (
                  <TableCell key={action} className="text-center">
                    <Checkbox
                      checked={grants[permission.id] ?? false}
                      disabled={!canEdit}
                      onCheckedChange={(checked) => toggle(permission, checked === true)}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
