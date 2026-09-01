"use client";

import { useState, useTransition } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteCostCenter,
  setCostCenterActive,
  updateCostCenter,
} from "@/features/accounting/cost-centers/actions";
import type { CostCenterInput } from "@/features/accounting/cost-centers/schemas";
import { CostCenterForm, type CostCenterParentOption } from "./cost-center-form";

export function CostCenterRowActions({
  costCenterId,
  defaultValues,
  parentOptions,
  isActive,
  canEdit,
  canDelete,
  canManageGroups,
}: {
  costCenterId: string;
  defaultValues: CostCenterInput;
  parentOptions: CostCenterParentOption[];
  isActive: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** False when the viewer may not manage group cost centres. */
  canManageGroups: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string } | undefined>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) toast.error(result.error);
      else toast.success(successMessage);
    });
  }

  if (!canEdit && !canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={isPending}>
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem
              onSelect={() =>
                run(
                  () => setCostCenterActive(costCenterId, !isActive),
                  isActive ? "Cost center disabled" : "Cost center enabled",
                )
              }
            >
              {isActive ? "Disable" : "Enable"}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => run(() => deleteCostCenter(costCenterId), "Cost center deleted")}
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit cost center</DialogTitle>
          </DialogHeader>
          <CostCenterForm
            defaultValues={defaultValues}
            parentOptions={parentOptions}
            canManageGroups={canManageGroups}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              const result = await updateCostCenter(costCenterId, values);
              if (!result?.error) {
                toast.success("Cost center updated");
                setEditOpen(false);
              }
              return result;
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
