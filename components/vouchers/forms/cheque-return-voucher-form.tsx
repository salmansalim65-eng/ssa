"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, FileTextIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
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
import { AccountSelect, type AccountOption } from "@/components/vouchers/account-select";
import { createChequeReturnVoucher } from "@/features/accounting/vouchers/cheque-return/actions";
import {
  chequeReturnVoucherSchema,
  type ChequeReturnVoucherFormValues,
  type ChequeReturnVoucherInput,
} from "@/features/accounting/vouchers/cheque-return/schemas";

export interface ReturnablePdcOption {
  id: string;
  type: "pdc_payment_voucher" | "pdc_receipt_voucher";
  label: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function ChequeReturnVoucherForm({
  pdcOptions,
  accounts,
}: {
  pdcOptions: ReturnablePdcOption[];
  accounts: AccountOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ChequeReturnVoucherFormValues, unknown, ChequeReturnVoucherInput>({
    resolver: zodResolver(chequeReturnVoucherSchema),
    defaultValues: {
      originalPdcType: "pdc_payment_voucher",
      originalPdcId: "",
      returnDate: today(),
      returnReason: "",
      penaltyAmount: 0,
      penaltyAccountId: "",
    },
  });

  const penaltyAmount = useWatch({ control: form.control, name: "penaltyAmount" });
  const hasPenalty = Number(penaltyAmount) > 0;

  function onSubmit(values: ChequeReturnVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createChequeReturnVoucher(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      toast.success("Cheque return voucher created");
      router.push(`/accounting/vouchers/cheque_return_voucher/${result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Document header */}
        <FormSection
          title="Document information"
          description="Details of the returned post-dated cheque."
          icon={FileTextIcon}
        >
          <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="originalPdcId"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Cheque being returned</FormLabel>
              <Select
                onValueChange={(value) => {
                  const option = pdcOptions.find((o) => o.id === value);
                  field.onChange(value);
                  if (option) form.setValue("originalPdcType", option.type);
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a pending post-dated cheque" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {pdcOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
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
          name="returnDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Return date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="returnReason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Return reason</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Insufficient funds" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="penaltyAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Penalty amount</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={field.value as number} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {hasPenalty && (
          <FormField
            control={form.control}
            name="penaltyAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Penalty account</FormLabel>
                <AccountSelect accounts={accounts} value={field.value} onValueChange={field.onChange} />
                <FormDescription>Where the penalty amount is recorded.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
          </div>
        </FormSection>

        {formError && (
          <p className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            {formError}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" asChild>
            <Link href="/accounting/vouchers/cheque_return_voucher">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create cheque return voucher"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
