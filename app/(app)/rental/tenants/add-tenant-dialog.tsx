"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTenant } from "@/features/rental/tenants/actions";
import type { TenantInput } from "@/features/rental/tenants/schemas";
import { TenantForm } from "./tenant-form";

const emptyValues: TenantInput = { name: "", idNumber: "", phone: "", email: "", address: "" };

export function AddTenantDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> Add tenant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tenant</DialogTitle>
        </DialogHeader>
        <TenantForm
          defaultValues={emptyValues}
          submitLabel="Add tenant"
          onSubmit={async (values) => {
            const result = await createTenant(values);
            if (!result?.error) {
              toast.success("Tenant added");
              setOpen(false);
            }
            return result;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
