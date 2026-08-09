"use client";

import { useState, useTransition } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { deleteTenant, setTenantActive, updateTenant } from "@/features/rental/tenants/actions";
import type { TenantInput } from "@/features/rental/tenants/schemas";
import { TenantForm } from "./tenant-form";

export function TenantRowActions({
  tenantId,
  tenantName,
  defaultValues,
  isActive,
  canEdit,
  canDelete,
}: {
  tenantId: string;
  tenantName: string;
  defaultValues: TenantInput;
  isActive: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

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
          {canEdit && <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>}
          {canEdit && (
            <DropdownMenuItem
              onSelect={() =>
                startTransition(async () => {
                  const result = await setTenantActive(tenantId, !isActive);
                  if (result?.error) toast.error(result.error);
                  else toast.success(isActive ? "Tenant disabled" : "Tenant enabled");
                })
              }
            >
              {isActive ? "Disable" : "Enable"}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete tenant</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium text-foreground">{tenantName}</span>? This can only be done when the
              tenant has no linked leases, invoices or payments.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteTenant(tenantId);
                  if (result?.error) toast.error(result.error);
                  else {
                    toast.success("Tenant deleted");
                    setDeleteOpen(false);
                  }
                })
              }
            >
              Delete tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit tenant</DialogTitle>
          </DialogHeader>
          <TenantForm
            defaultValues={defaultValues}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              const result = await updateTenant(tenantId, values);
              if (!result?.error) {
                toast.success("Tenant updated");
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
