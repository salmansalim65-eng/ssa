"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createValuation, deleteValuation } from "@/features/assets/valuations/actions";
import {
  valuationSchema,
  type ValuationFormValues,
  type ValuationInput,
} from "@/features/assets/valuations/schemas";
import { blankAmount, amountValue } from "@/lib/forms/amount";

export interface ValuationRow {
  id: string;
  valuationDate: string;
  marketValue: number;
  valuer: string | null;
  notes: string | null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function ValuationHistory({
  assetId,
  valuations,
  canEdit,
  canDelete,
}: {
  assetId: string;
  valuations: ValuationRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<ValuationFormValues, unknown, ValuationInput>({
    resolver: zodResolver(valuationSchema),
    defaultValues: { valuationDate: today(), marketValue: blankAmount, valuer: "", notes: "" },
  });

  function onSubmit(values: ValuationInput) {
    startTransition(async () => {
      const result = await createValuation(assetId, values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Valuation recorded");
      form.reset({ valuationDate: today(), marketValue: blankAmount, valuer: "", notes: "" });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Market value</TableHead>
            <TableHead>Valuer</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {valuations.map((v) => (
            <TableRow key={v.id}>
              <TableCell>{v.valuationDate}</TableCell>
              <TableCell>{v.marketValue.toLocaleString()}</TableCell>
              <TableCell>{v.valuer ?? "—"}</TableCell>
              <TableCell className="max-w-xs truncate">{v.notes ?? "—"}</TableCell>
              <TableCell>
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await deleteValuation(v.id, assetId);
                        if (result?.error) toast.error(result.error);
                        else router.refresh();
                      })
                    }
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {valuations.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No valuations recorded yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {canEdit && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <PlusIcon /> Record valuation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record valuation</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="valuationDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valuation date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="marketValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Market value</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="valuer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valuer</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Saving…" : "Record valuation"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
