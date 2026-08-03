"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
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
import { upsertDocumentSequence } from "@/features/accounting/document-sequences/actions";
import {
  documentSequenceSchema,
  type DocumentSequenceFormValues,
  type DocumentSequenceInput,
} from "@/features/accounting/document-sequences/schemas";
import type { VoucherType } from "@/lib/vouchers/meta";

export function DocumentSequenceDialog({
  voucherType,
  label,
  defaultValues,
  triggerLabel,
}: {
  voucherType: VoucherType;
  label: string;
  defaultValues: { prefix: string; padding: number; resetPolicy: "never" | "yearly" | "monthly" };
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<DocumentSequenceFormValues, unknown, DocumentSequenceInput>({
    resolver: zodResolver(documentSequenceSchema),
    defaultValues: { voucherType, ...defaultValues },
  });
  const watchedPrefix = useWatch({ control: form.control, name: "prefix" });

  function onSubmit(values: DocumentSequenceInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await upsertDocumentSequence(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Document sequence saved");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} numbering</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="prefix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prefix</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="padding"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Number padding</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} max={12} {...field} value={field.value as number} />
                  </FormControl>
                  <FormDescription>
                    e.g. padding 6 renders as {watchedPrefix || "PV"}-000001
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="resetPolicy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reset policy</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
