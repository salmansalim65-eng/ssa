"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { updateCompany } from "@/features/admin/companies/actions";
import { updateCompanySchema, type UpdateCompanyInput } from "@/features/admin/companies/schemas";

export function CompanyEditForm({
  companyId,
  defaultValues,
  canEdit,
}: {
  companyId: string;
  defaultValues: UpdateCompanyInput;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<UpdateCompanyInput>({
    resolver: zodResolver(updateCompanySchema),
    defaultValues,
  });

  function onSubmit(values: UpdateCompanyInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await updateCompany(companyId, values);
      if (result?.error) {
        setFormError(result.error);
      } else {
        toast.success("Company updated");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Company name</FormLabel>
              <FormControl>
                <Input disabled={!canEdit} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Country</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!canEdit}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="PK">Pakistan</SelectItem>
                  <SelectItem value="AE">United Arab Emirates</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input disabled={!canEdit} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="accountingPeriodStart"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Accounting period start</FormLabel>
              <FormControl>
                <Input type="date" disabled={!canEdit} {...field} value={(field.value as string) ?? ""} />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Reports won&apos;t show activity before this date. Leave blank to use the earliest lease.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        {canEdit && (
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        )}
      </form>
    </Form>
  );
}
