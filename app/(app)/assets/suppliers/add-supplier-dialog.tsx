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
import { createSupplier } from "@/features/assets/suppliers/actions";
import type { SupplierInput } from "@/features/assets/suppliers/schemas";
import { SupplierForm } from "./supplier-form";

const emptyValues: SupplierInput = { name: "", contactPerson: "", phone: "", email: "", address: "" };

export function AddSupplierDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> Add supplier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add supplier</DialogTitle>
        </DialogHeader>
        <SupplierForm
          defaultValues={emptyValues}
          submitLabel="Add supplier"
          onSubmit={async (values) => {
            const result = await createSupplier(values);
            if (!result?.error) {
              toast.success("Supplier added");
              setOpen(false);
            }
            return result;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
