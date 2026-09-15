"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListPlusIcon, PencilIcon, PlusIcon, TagsIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createTag, createTagsBulk, deleteTag, updateTag } from "@/features/core/tags/actions";
import { tagSchema, type TagFormValues, type TagInput } from "@/features/core/tags/schemas";

export interface TagRow {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  /** How many expense lines are filed under it, and for how much. */
  usedCount: number;
  usedAmount: number;
}

export function TagManager({
  tags,
  canCreate,
  canEdit,
  canDelete,
}: {
  tags: TagRow[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  // null = closed; "new" = adding; a row = editing that one.
  const [editing, setEditing] = useState<TagRow | "new" | null>(null);
  const [isPending, startTransition] = useTransition();
  // The paste-a-list dialog, kept apart from the one-at-a-time form above.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const form = useForm<TagFormValues, unknown, TagInput>({
    resolver: zodResolver(tagSchema),
    defaultValues: { name: "", description: "", isActive: true },
  });

  function open(target: TagRow | "new") {
    form.reset(
      target === "new"
        ? { name: "", description: "", isActive: true }
        : { name: target.name, description: target.description, isActive: target.isActive },
    );
    setEditing(target);
  }

  function onSubmit(values: TagInput) {
    startTransition(async () => {
      const result = editing === "new" || editing === null ? await createTag(values) : await updateTag(editing.id, values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(editing === "new" ? "Tag added" : "Tag updated");
      setEditing(null);
    });
  }

  function addMany() {
    startTransition(async () => {
      const result = await createTagsBulk(bulkText);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      const parts = [`${result.created} tag${result.created === 1 ? "" : "s"} added`];
      if (result.skipped?.length) parts.push(`${result.skipped.length} already existed`);
      if (result.invalid?.length) parts.push(`${result.invalid.length} skipped as invalid`);
      toast.success(parts.join(" · "));
      setBulkText("");
      setBulkOpen(false);
    });
  }

  function remove(tag: TagRow) {
    startTransition(async () => {
      const result = await deleteTag(tag.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${tag.name} removed`);
    });
  }

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
            <ListPlusIcon /> Add many
          </Button>
          <Button size="sm" onClick={() => open("new")}>
            <PlusIcon /> Add tag
          </Button>
        </div>
      )}

      <Dialog open={bulkOpen} onOpenChange={(o) => !isPending && setBulkOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add many tags</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One tag per line. Numbering is ignored, so a list can be pasted straight in; names
              that already exist are left alone.
            </p>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={12}
              placeholder={"Monthly Home Expense\nHome Grocery\nHome Maintenance"}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-ring/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setBulkOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={addMany} disabled={isPending || !bulkText.trim()}>
                {isPending ? "Adding…" : "Add tags"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border bg-card shadow-xs">
        {tags.length === 0 ? (
          <EmptyState
            icon={TagsIcon}
            title="No tags yet"
            description="Add a tag to file expenses under — Maintenance, Travel, Utilities."
            action={
              canCreate ? (
                <Button size="sm" onClick={() => open("new")}>
                  <PlusIcon /> Add tag
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Tag</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.description || "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {t.usedCount || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {t.usedAmount ? formatMoney(t.usedAmount) : "—"}
                  </TableCell>
                  <TableCell>
                    <span className={cn("text-sm", t.isActive ? "text-success" : "text-muted-foreground")}>
                      {t.isActive ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canEdit && (
                        <Button variant="ghost" size="icon" onClick={() => open(t)} aria-label={`Edit ${t.name}`}>
                          <PencilIcon className="size-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={isPending}
                          onClick={() => remove(t)}
                          aria-label={`Remove ${t.name}`}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add tag" : "Edit tag"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Maintenance" {...field} value={(field.value as string) ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} value={(field.value as string) ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-start gap-2.5">
                    <FormControl>
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <div className="space-y-0.5">
                      <FormLabel>Active</FormLabel>
                      <FormDescription>An inactive tag stays on past vouchers but is no longer offered.</FormDescription>
                    </div>
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving…" : editing === "new" ? "Add tag" : "Save changes"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
