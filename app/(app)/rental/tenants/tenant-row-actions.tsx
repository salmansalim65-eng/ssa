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
import { setTenantActive, updateTenant } from "@/features/rental/tenants/actions";
import type { TenantInput } from "@/features/rental/tenants/schemas";
import { TenantForm } from "./tenant-form";

export function TenantRowActions({
  tenantId,
  defaultValues,
  isActive,
  canEdit,
}: {
  tenantId: string;
  defaultValues: TenantInput;
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
                const result = await setTenantActive(tenantId, !isActive);
                if (result?.error) toast.error(result.error);
                else toast.success(isActive ? "Tenant disabled" : "Tenant enabled");
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
