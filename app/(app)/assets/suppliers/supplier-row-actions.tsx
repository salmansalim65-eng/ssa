"use client";

import { useState, useTransition } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setSupplierActive, updateSupplier } from "@/features/assets/suppliers/actions";
import type { SupplierInput } from "@/features/assets/suppliers/schemas";
import { SupplierForm } from "./supplier-form";

export function SupplierRowActions({
  supplierId,
  defaultValues,
  isActive,
  canEdit,
}: {
  supplierId: string;
  defaultValues: SupplierInput;
  isActive: boolean;
  canEdit: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!canEdit) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={isPending}>
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
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
        </DropdownMenuContent>
      </DropdownMenu>

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
