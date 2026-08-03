"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addWorkflowStep } from "@/features/accounting/approval-workflows/actions";
import {
  stepSchema,
  type StepFormValues,
  type StepInput,
} from "@/features/accounting/approval-workflows/schemas";
import type { VoucherType } from "@/lib/vouchers/meta";

export function AddStepForm({
  voucherType,
  roles,
}: {
  voucherType: VoucherType;
  roles: { id: string; name: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<StepFormValues, unknown, StepInput>({
    resolver: zodResolver(stepSchema),
    defaultValues: { approverRoleId: "", minAmount: "", maxAmount: "" },
  });

  function onSubmit(values: StepInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await addWorkflowStep(voucherType, values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Step added");
      form.reset();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
        <FormField
          control={form.control}
          name="approverRoleId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Approver role</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="minAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Min amount</FormLabel>
              <FormControl>
                <Input placeholder="No minimum" className="w-32" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="maxAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max amount</FormLabel>
              <FormControl>
                <Input placeholder="No maximum" className="w-32" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isPending} size="sm">
          <PlusIcon /> Add step
        </Button>
        {formError && <p className="w-full text-sm text-destructive">{formError}</p>}
      </form>
    </Form>
  );
}
