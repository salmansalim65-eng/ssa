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
import { createCostCenter } from "@/features/accounting/cost-centers/actions";
import type { CostCenterInput } from "@/features/accounting/cost-centers/schemas";
import { CostCenterForm } from "./cost-center-form";

const emptyValues: CostCenterInput = {
  name: "",
  country: "",
  city: "",
  propertyType: "",
  building: "",
  plotNumber: "",
  owner: "",
  rentalStatus: "vacant",
};

export function AddCostCenterDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> Add cost center
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add cost center</DialogTitle>
        </DialogHeader>
        <CostCenterForm
          defaultValues={emptyValues}
          submitLabel="Add cost center"
          onSubmit={async (values) => {
            const result = await createCostCenter(values);
            if (!result?.error) {
              toast.success("Cost center created");
              setOpen(false);
            }
            return result;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
