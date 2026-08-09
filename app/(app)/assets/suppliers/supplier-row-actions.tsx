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
import { deleteSupplier, setSupplierActive, updateSupplier } from "@/features/assets/suppliers/actions";
import type { SupplierInput } from "@/features/assets/suppliers/schemas";
import { SupplierForm } from "./supplier-form";

export function SupplierRowActions({
  supplierId,
  supplierName,
  defaultValues,
  isActive,
  canEdit,
  canDelete,
}: {
  supplierId: string;
  supplierName: string;
  defaultValues: SupplierInput;
  isActive: boolean;
  canEdit: boolean;
  canDelete?: boolean;
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
                  const result = await setSupplierActive(supplierId, !isActive);
                  if (result?.error) toast.error(result.error);
                  else toast.success(isActive ? "Supplier disabled" : "Supplier enabled");
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
            <DialogTitle>Delete supplier</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium text-foreground">{supplierName}</span>? This can only be done when the
              supplier has no linked purchase vouchers.
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
                  const result = await deleteSupplier(supplierId);
                  if (result?.error) toast.error(result.error);
                  else {
                    toast.success("Supplier deleted");
                    setDeleteOpen(false);
                  }
                })
              }
            >
              Delete supplier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit supplier</DialogTitle>
          </DialogHeader>
          <SupplierForm
            defaultValues={defaultValues}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              const result = await updateSupplier(supplierId, values);
              if (!result?.error) {
                toast.success("Supplier updated");
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
