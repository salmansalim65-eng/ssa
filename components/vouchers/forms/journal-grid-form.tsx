"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, FileTextIcon, ListPlusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-section";
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
import { AccountCombobox, type AccountOption } from "@/components/vouchers/account-combobox";
import { CurrencySelect, type CurrencyOption } from "@/components/vouchers/currency-select";
import { DateInput } from "@/components/vouchers/date-input";
import { uploadAttachment } from "@/features/attachments/actions";
import {
  journalVoucherSchema,
  type JournalVoucherFormValues,
  type JournalVoucherInput,
} from "@/features/accounting/vouchers/journal/schemas";

export interface CostCenterOption {
  id: string;
  name: string;
}

type ActionResult = { success?: boolean; id?: string; error?: string } | undefined;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { accountId: "", costCenterId: "", debit: 0, credit: 0, reference: "", remarks: "" };
}

export function JournalGridForm({
  accounts,
  currencies,
  costCenters,
  voucherType,
  showHeaderExtras = false,
  createLabel,
  onCreate,
  onUpdate,
  voucherId,
  initialValues,
}: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
  voucherType: "journal_voucher" | "jv_maintenance_voucher";
  showHeaderExtras?: boolean;
  createLabel: string;
  onCreate: (input: JournalVoucherInput) => Promise<ActionResult>;
  onUpdate: (id: string, input: JournalVoucherInput) => Promise<ActionResult>;
  voucherId?: string;
  initialValues?: JournalVoucherFormValues;
}) {
  const router = useRouter();
  const isEdit = !!voucherId;
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

  const form = useForm<JournalVoucherFormValues, unknown, JournalVoucherInput>({
    resolver: zodResolver(journalVoucherSchema),
    defaultValues: initialValues ?? {
      entryDate: today(),
      dueDate: "",
      refNo: "",
      currencyId: currencies[0]?.id ?? "",
      exchangeRate: currencies[0]?.rate ?? 1,
      narration: "",
      lines: [emptyLine(), emptyLine()],
    },
  });

  const rateById = new Map(currencies.map((c) => [c.id, c.rate ?? 1] as const));

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const totalDebit = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.debit) || 0), 0);
  const totalCredit = (watchedLines ?? []).reduce((sum, l) => sum + (Number(l?.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  function onSubmit(values: JournalVoucherInput) {
    setFormError(null);
    startTransition(async () => {
      const result = isEdit ? await onUpdate(voucherId!, values) : await onCreate(values);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      const savedId = isEdit ? voucherId : result?.id;
      // Upload the attachment (if any) against the now-existing voucher.
      const file = showHeaderExtras ? attachmentFile : null;
      if (file && savedId) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await uploadAttachment("attachments", "journal_voucher", savedId, fd);
        if (up?.error) toast.error(`Voucher saved, but the attachment failed: ${up.error}`);
      }
      toast.success(isEdit ? "Voucher updated" : "Voucher created");
      router.push(`/accounting/vouchers/${voucherType}/${savedId}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Voucher header */}
        <FormSection
          title="Document information"
          description="Header details for this voucher."
          icon={FileTextIcon}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormItem>
            <FormLabel>Document No.</FormLabel>
            <Input value="Auto" disabled readOnly />
          </FormItem>
          <FormField
            control={form.control}
            name="entryDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl>
                  <DateInput {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Due Date</FormLabel>
                <FormControl>
                  <DateInput {...field} value={(field.value as string) ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="narration"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Narration</FormLabel>
                <FormControl>
                  <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {showHeaderExtras && (
            <FormField
              control={form.control}
              name="refNo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>REF No.</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {showHeaderExtras && (
            <FormItem>
              <FormLabel>Attachment</FormLabel>
              <FormControl>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                />
              </FormControl>
            </FormItem>
          )}
          <FormField
            control={form.control}
            name="currencyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency</FormLabel>
                <CurrencySelect
                  currencies={currencies}
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    form.setValue("exchangeRate", rateById.get(v) ?? 1, { shouldValidate: true });
                  }}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="exchangeRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency Conv.</FormLabel>
                <FormControl>
                  <Input type="number" step="0.0001" min="0" {...field} value={field.value as number} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          </div>
        </FormSection>

        {/* Line grid */}
        <FormSection
          title="Entries"
          description="Debit and credit lines — the voucher must balance before it can be saved."
          icon={ListPlusIcon}
          contentClassName="p-0"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <PlusIcon /> Add row
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                  <th className="w-10">Sno</th>
                  <th className="w-44">Cost Centre</th>
                  <th className="min-w-[220px]">Account</th>
                  <th className="w-32 text-right">Debit</th>
                  <th className="w-32 text-right">Credit</th>
                  <th className="w-36">Reference</th>
                  <th className="min-w-[150px]">Remarks</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((line, index) => (
                  <tr key={line.id} className="border-b align-top last:border-0 [&_td]:px-3 [&_td]:py-2">
                    <td className="pt-4 text-muted-foreground">{index + 1}</td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.costCenterId`}
                        render={({ field }) => (
                          <FormItem>
                            <Select
                              value={field.value ? field.value : "none"}
                              onValueChange={(v) => field.onChange(v === "none" ? "" : v)}
                            >
                              <FormControl>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="None" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">— None —</SelectItem>
                                {costCenters.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.accountId`}
                        render={({ field }) => (
                          <FormItem>
                            <AccountCombobox accounts={accounts} value={field.value} onValueChange={field.onChange} />
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.debit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" className="text-right tabular-nums" {...field} value={field.value as number} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.credit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" className="text-right tabular-nums" {...field} value={field.value as number} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.reference`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.remarks`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                    <td className="pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={fields.length <= 2}
                        onClick={() => remove(index)}
                        aria-label="Remove row"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Strong totals bar */}
          <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2 border-t bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-muted-foreground">Total Debit</span>
              <span className="text-base font-semibold tabular-nums text-foreground">{totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-muted-foreground">Total Credit</span>
              <span className="text-base font-semibold tabular-nums text-foreground">{totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${balanced ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive"}`}>
              <span className={`size-1.5 rounded-full ${balanced ? "bg-success" : "bg-destructive"}`} aria-hidden />
              {balanced ? "Balanced" : "Not balanced"}
            </span>
          </div>
        </FormSection>

        {form.formState.errors.lines?.root?.message && (
          <p className="text-sm text-destructive">{form.formState.errors.lines.root.message}</p>
        )}
        {formError && (
          <p className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            {formError}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : createLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
