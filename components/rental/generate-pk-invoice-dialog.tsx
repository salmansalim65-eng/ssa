"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { blankAmount, amountValue } from "@/lib/forms/amount";
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
import { generatePkRentInvoice } from "@/features/rental/pk-rent-invoices/actions";
import {
  generatePkInvoiceFormSchema,
  type GeneratePkInvoiceFormInput,
  type GeneratePkInvoiceFormValues,
} from "@/features/rental/pk-rent-invoices/schemas";

const utilityTypeLabels = { electricity: "Electricity", gas: "Gas", water: "Water", other: "Other" } as const;

export function GeneratePkInvoiceDialog({
  scheduleId,
  rentAmount,
  remainingAdvance,
}: {
  scheduleId: string;
  rentAmount: number;
  remainingAdvance: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<GeneratePkInvoiceFormValues, unknown, GeneratePkInvoiceFormInput>({
    resolver: zodResolver(generatePkInvoiceFormSchema),
    defaultValues: { utilityCharges: [], advanceAdjusted: blankAmount },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "utilityCharges" });
  const watched = useWatch({ control: form.control });
  const utilityTotal = (watched.utilityCharges ?? []).reduce((sum, u) => sum + (Number(u?.amount) || 0), 0);
  const advanceAdjusted = Number(watched.advanceAdjusted) || 0;
  const netTotal = rentAmount + utilityTotal - advanceAdjusted;

  function onSubmit(values: GeneratePkInvoiceFormInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await generatePkRentInvoice(scheduleId, { ...values, scheduleId });
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Invoice generated");
      setOpen(false);
      router.push(`/rental/pk/invoices/${result.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Generate invoice
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate rent invoice</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <p className="text-sm text-muted-foreground">Rent for this period: {rentAmount.toLocaleString()}</p>

            <div className="space-y-2">
              <FormLabel>Utility charges</FormLabel>
              {fields.map((line, index) => (
                <div key={line.id} className="flex items-start gap-2">
                  <FormField
                    control={form.control}
                    name={`utilityCharges.${index}.utilityType`}
                    render={({ field }) => (
                      <FormItem className="w-36">
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.entries(utilityTypeLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
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
                    name={`utilityCharges.${index}.amount`}
                    render={({ field }) => (
                      <FormItem className="w-28">
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`utilityCharges.${index}.description`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input placeholder="Description (optional)" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ utilityType: "electricity", amount: blankAmount, description: "" })}
              >
                <PlusIcon /> Add utility charge
              </Button>
            </div>

            <FormField
              control={form.control}
              name="advanceAdjusted"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Advance rent to adjust (remaining: {remainingAdvance.toLocaleString()})</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-sm font-medium">Net invoice total: {netTotal.toLocaleString()}</p>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Generating…" : "Generate invoice"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
