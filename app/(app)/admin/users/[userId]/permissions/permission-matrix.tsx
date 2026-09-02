"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setUserPermissions } from "@/features/admin/users/permission-actions";
import type { PermissionAction } from "@/types/database.types";

function keyOf(moduleKey: string, action: string) {
  return `${moduleKey}:${action}`;
}

// A few module keys read better with a hand-written label than title-casing the
// key. The key itself stays stable for grants/RLS.
const MODULE_LABEL_OVERRIDES: Record<string, string> = {
  jv_maintenance_voucher: "JV Service Charges",
};

function prettifyModule(moduleKey: string) {
  return (
    MODULE_LABEL_OVERRIDES[moduleKey] ??
    moduleKey
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function PermissionMatrix({
  userId,
  modules,
  actions,
  initialAllowed,
}: {
  userId: string;
  modules: string[];
  actions: PermissionAction[];
  initialAllowed: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [allowed, setAllowed] = useState(() => new Set(initialAllowed));

  function toggle(moduleKey: string, action: PermissionAction) {
    setAllowed((prev) => {
      const next = new Set(prev);
      const key = keyOf(moduleKey, action);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    const next = new Set<string>();
    for (const moduleKey of modules) {
      for (const action of actions) next.add(keyOf(moduleKey, action));
    }
    setAllowed(next);
  }

  function clearAll() {
    setAllowed(new Set());
  }

  function toggleRow(moduleKey: string, allow: boolean) {
    setAllowed((prev) => {
      const next = new Set(prev);
      for (const action of actions) {
        const key = keyOf(moduleKey, action);
        if (allow) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function rowAllChecked(moduleKey: string) {
    return actions.every((action) => allowed.has(keyOf(moduleKey, action)));
  }

  function save() {
    startTransition(async () => {
      const grants = [...allowed].map((key) => {
        const [moduleKey, action] = key.split(":");
        return { moduleKey, action: action as PermissionAction };
      });
      const result = await setUserPermissions(userId, grants);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Permissions updated");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={selectAll} disabled={isPending}>
          Select all
        </Button>
        <Button variant="outline" size="sm" onClick={clearAll} disabled={isPending}>
          Clear all
        </Button>
        <div className="ml-auto">
          <Button size="sm" onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader className="sticky top-0 z-20">
            <TableRow className="hover:bg-transparent">
              {/* z-30: frozen both ways, so above the rest of the header row. */}
              <TableHead className="sticky left-0 z-30 bg-header">Module</TableHead>
              {actions.map((action) => (
                <TableHead key={action} className="bg-header text-center">
                  {capitalize(action)}
                </TableHead>
              ))}
              <TableHead className="bg-header text-center">Row</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {modules.map((moduleKey) => {
              const allChecked = rowAllChecked(moduleKey);
              return (
                <TableRow key={moduleKey}>
                  <TableCell className="sticky left-0 z-10 bg-card font-medium">
                    {prettifyModule(moduleKey)}
                  </TableCell>
                  {actions.map((action) => (
                    <TableCell key={action} className="text-center">
                      <div className="flex justify-center">
                        <Checkbox
                          checked={allowed.has(keyOf(moduleKey, action))}
                          onCheckedChange={() => toggle(moduleKey, action)}
                          aria-label={`${prettifyModule(moduleKey)} ${capitalize(action)}`}
                        />
                      </div>
                    </TableCell>
                  ))}
                  <TableCell className="text-center">
                    <Button variant="ghost" size="sm" onClick={() => toggleRow(moduleKey, !allChecked)}>
                      {allChecked ? "None" : "All"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        Unchecked = denied. Clear everything and save to remove custom permissions and use this
        user&apos;s role instead.
      </p>
    </div>
  );
}
