"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  ListTreeIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { SummaryCard } from "@/components/ui/summary-card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  createAccount,
  deleteAccount,
  setAccountActive,
  updateAccount,
} from "@/features/accounting/chart-of-accounts/actions";
import type { AccountInput } from "@/features/accounting/chart-of-accounts/schemas";
import { AccountForm, type CurrencyOption, type ParentOption } from "./account-form";

export interface AccountRow {
  id: string;
  account_code: string;
  account_name: string;
  parent_id: string | null;
  account_type: ParentOption["account_type"];
  currency_id: string | null;
  currency_code: string | null;
  opening_balance: number;
  is_group: boolean;
  is_active: boolean;
  is_cash: boolean;
  is_bank: boolean;
}

type DialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; account: AccountRow };

type TypeFilter = "all" | AccountRow["account_type"];
type LevelFilter = "all" | "group" | "posting";
type StatusFilter = "all" | "active" | "inactive";

const emptyValues: AccountInput = {
  accountName: "",
  parentId: "",
  accountType: "asset",
  currencyId: "",
  isGroup: false,
  openingBalance: 0,
  isCash: false,
  isBank: false,
};

const typeBadgeClass: Record<AccountRow["account_type"], string> = {
  asset: "border-info/30 bg-info/10 text-info",
  liability: "border-warning/30 bg-warning/10 text-warning",
  equity: "border-primary/30 bg-primary/10 text-primary",
  income: "border-success/30 bg-success/10 text-success",
  expense: "border-destructive/30 bg-destructive/10 text-destructive",
};

function descendantIds(accounts: AccountRow[], rootId: string): Set<string> {
  const childrenOf = new Map<string, AccountRow[]>();
  for (const a of accounts) {
    const key = a.parent_id ?? "__root__";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(a);
  }
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return result;
}

export function AccountTree({
  accounts,
  currencies,
  canCreate,
  canEdit,
  canDelete,
}: {
  accounts: AccountRow[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(accounts.filter((a) => a.is_group).map((a) => a.id)),
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filtersActive =
    query.trim() !== "" || typeFilter !== "all" || levelFilter !== "all" || statusFilter !== "all";

  const summary = useMemo(() => {
    const total = accounts.length;
    const groups = accounts.filter((a) => a.is_group).length;
    return {
      total,
      groups,
      posting: total - groups,
      active: accounts.filter((a) => a.is_active).length,
    };
  }, [accounts]);

  const { childrenByParent, parentById } = useMemo(() => {
    const childrenByParent = new Map<string, AccountRow[]>();
    const parentById = new Map<string, string | null>();
    for (const a of accounts) {
      const key = a.parent_id ?? "__root__";
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(a);
      parentById.set(a.id, a.parent_id);
    }
    for (const list of childrenByParent.values())
      list.sort((a, b) => a.account_code.localeCompare(b.account_code));
    return { childrenByParent, parentById };
  }, [accounts]);

  // Accounts passing the active filters, plus their ancestors so the branch
  // stays readable. When filtering, every ancestor is force-expanded.
  const visibleIds = useMemo(() => {
    if (!filtersActive) return null;
    const q = query.trim().toLowerCase();
    const matched = accounts.filter((a) => {
      if (typeFilter !== "all" && a.account_type !== typeFilter) return false;
      if (levelFilter === "group" && !a.is_group) return false;
      if (levelFilter === "posting" && a.is_group) return false;
      if (statusFilter === "active" && !a.is_active) return false;
      if (statusFilter === "inactive" && a.is_active) return false;
      if (q) {
        const haystack = `${a.account_code} ${a.account_name} ${a.account_type}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    const visible = new Set<string>();
    for (const a of matched) {
      visible.add(a.id);
      let parent = a.parent_id;
      while (parent && !visible.has(parent)) {
        visible.add(parent);
        parent = parentById.get(parent) ?? null;
      }
    }
    return visible;
  }, [accounts, filtersActive, query, typeFilter, levelFilter, statusFilter, parentById]);

  const groupOptions: ParentOption[] = accounts
    .filter((a) => a.is_group)
    .map((a) => ({
      id: a.id,
      account_code: a.account_code,
      account_name: a.account_name,
      account_type: a.account_type,
    }));

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(accounts.filter((a) => a.is_group).map((a) => a.id)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }
  function clearFilters() {
    setQuery("");
    setTypeFilter("all");
    setLevelFilter("all");
    setStatusFilter("all");
  }

  function run(action: () => Promise<{ error?: string } | undefined>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) toast.error(result.error);
      else toast.success(successMessage);
    });
  }

  function renderRows(parentKey: string, depth: number): ReactNode[] {
    const rows = childrenByParent.get(parentKey) ?? [];
    return rows.flatMap((account) => {
      if (visibleIds && !visibleIds.has(account.id)) return [];

      const children = childrenByParent.get(account.id) ?? [];
      const visibleChildren = visibleIds
        ? children.filter((c) => visibleIds.has(c.id))
        : children;
      const hasChildren = visibleChildren.length > 0;
      const isExpanded = filtersActive ? true : expanded.has(account.id);
      const isGroup = account.is_group;

      const row = (
        <TableRow
          key={account.id}
          className={cn(
            "group",
            // Group rows carry a soft logo-blue tint so the hierarchy reads at
            // a glance; posting rows stay on the plain white card surface.
            isGroup
              ? "bg-group/[0.10] hover:bg-group/[0.14]"
              : "hover:bg-muted/30",
            !account.is_active && "opacity-70",
          )}
        >
          {/* Account code + tree affordance */}
          <td className="p-0 align-middle">
            <div className="flex items-center py-2 pr-3" style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}>
              {/* Depth guide lines */}
              {Array.from({ length: depth }).map((_, i) => (
                <span key={i} aria-hidden className="mr-1 h-6 w-px shrink-0 bg-border" />
              ))}
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggle(account.id)}
                  className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <ChevronDownIcon className="size-4" />
                  ) : (
                    <ChevronRightIcon className="size-4" />
                  )}
                </button>
              ) : (
                <span className="mr-1 inline-block size-5 shrink-0" />
              )}
              {isGroup ? (
                isExpanded ? (
                  <FolderOpenIcon className="mr-2 size-4 shrink-0 text-group" />
                ) : (
                  <FolderIcon className="mr-2 size-4 shrink-0 text-group" />
                )
              ) : (
                <FileTextIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "font-mono text-xs",
                  isGroup ? "font-bold text-group" : "text-muted-foreground",
                )}
              >
                {account.account_code}
              </span>
            </div>
          </td>

          {/* Account name */}
          <td className="p-3 align-middle">
            <div className="flex items-center gap-2">
              <span className={cn("truncate", isGroup ? "font-bold text-group" : "font-medium")}>
                {account.account_name}
              </span>
              {isGroup && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-group/30 bg-group/10 text-[0.65rem] uppercase tracking-wide text-group"
                >
                  Group
                </Badge>
              )}
              {account.is_cash && (
                <Badge variant="outline" className="shrink-0">
                  Cash
                </Badge>
              )}
              {account.is_bank && (
                <Badge variant="outline" className="shrink-0">
                  Bank
                </Badge>
              )}
            </div>
          </td>

          {/* Type */}
          <td className="p-3 align-middle">
            <Badge variant="outline" className={cn("capitalize", typeBadgeClass[account.account_type])}>
              {account.account_type}
            </Badge>
          </td>

          {/* Currency */}
          <td className="p-3 align-middle text-sm text-muted-foreground">
            {account.currency_code ?? <span className="text-muted-foreground/60">Base</span>}
          </td>

          {/* Status */}
          <td className="p-3 align-middle">
            <StatusBadge active={account.is_active} />
          </td>

          {/* Opening balance */}
          <td className="p-3 text-right align-middle font-mono text-sm tabular-nums">
            {isGroup ? (
              <span className="text-muted-foreground/50">—</span>
            ) : (
              formatMoney(account.opening_balance)
            )}
          </td>

          {/* Actions */}
          <td className="p-3 text-right align-middle">
            {(canCreate || canEdit || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 opacity-60 transition-opacity group-hover:opacity-100"
                    disabled={isPending}
                    aria-label="Account actions"
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canCreate && account.is_group && (
                    <DropdownMenuItem onSelect={() => setDialog({ mode: "create", parentId: account.id })}>
                      <PlusIcon className="size-4" /> Add child account
                    </DropdownMenuItem>
                  )}
                  {canEdit && (
                    <DropdownMenuItem onSelect={() => setDialog({ mode: "edit", account })}>
                      Edit
                    </DropdownMenuItem>
                  )}
                  {canEdit && (
                    <DropdownMenuItem
                      onSelect={() =>
                        run(
                          () => setAccountActive(account.id, !account.is_active),
                          account.is_active ? "Account disabled" : "Account enabled",
                        )
                      }
                    >
                      {account.is_active ? "Disable" : "Enable"}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => run(() => deleteAccount(account.id), "Account deleted")}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </td>
        </TableRow>
      );

      return isExpanded ? [row, ...renderRows(account.id, depth + 1)] : [row];
    });
  }

  const hasAccounts = accounts.length > 0;
  const bodyRows = renderRows("__root__", 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Chart of Accounts"
        description="Manage your organization's account hierarchy. Group accounts organize the structure; only posting accounts carry balances and can be posted to."
        actions={
          canCreate && (
            <Button onClick={() => setDialog({ mode: "create", parentId: null })}>
              <PlusIcon /> Add account
            </Button>
          )
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total accounts" value={summary.total} icon={ListTreeIcon} accent="primary" />
        <SummaryCard label="Group accounts" value={summary.groups} icon={FolderIcon} accent="neutral" />
        <SummaryCard label="Posting accounts" value={summary.posting} icon={FileTextIcon} accent="neutral" />
        <SummaryCard label="Active accounts" value={summary.active} icon={ListTreeIcon} accent="success" />
      </div>

      {/* Toolbar + tree */}
      <div className="rounded-lg border bg-card shadow-xs">
        <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by code or name…"
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
              <SelectTrigger className="w-[8.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="asset">Asset</SelectItem>
                <SelectItem value="liability">Liability</SelectItem>
                <SelectItem value="equity">Equity</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LevelFilter)}>
              <SelectTrigger className="w-[8.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="group">Groups</SelectItem>
                <SelectItem value="posting">Posting</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[8.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
            <div className="ml-1 hidden items-center gap-1 sm:flex">
              <Button variant="outline" size="sm" onClick={expandAll} disabled={filtersActive}>
                <ChevronsUpDownIcon /> Expand all
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll} disabled={filtersActive}>
                <ChevronsDownUpIcon /> Collapse
              </Button>
            </div>
          </div>
        </div>

        {!hasAccounts ? (
          <EmptyState
            icon={ListTreeIcon}
            title="No accounts yet"
            description="Build your chart of accounts by adding your first root account."
            action={
              canCreate && (
                <Button onClick={() => setDialog({ mode: "create", parentId: null })}>
                  <PlusIcon /> Add account
                </Button>
              )
            }
          />
        ) : bodyRows.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="No accounts match your filters"
            description="Try a different search term or clear the active filters."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[28%]">Account Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="w-24">Currency</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-40 text-right">Opening Balance</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>{bodyRows}</TableBody>
          </Table>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "edit" ? "Edit account" : "Add account"}</DialogTitle>
          </DialogHeader>
          {dialog && (
            <AccountForm
              currencies={currencies}
              parentOptions={
                dialog.mode === "edit"
                  ? groupOptions.filter(
                      (p) => p.id !== dialog.account.id && !descendantIds(accounts, dialog.account.id).has(p.id),
                    )
                  : groupOptions
              }
              defaultValues={
                dialog.mode === "edit"
                  ? {
                      accountName: dialog.account.account_name,
                      parentId: dialog.account.parent_id ?? "",
                      accountType: dialog.account.account_type,
                      currencyId: dialog.account.currency_id ?? "",
                      isGroup: dialog.account.is_group,
                      openingBalance: dialog.account.opening_balance,
                      isCash: dialog.account.is_cash,
                      isBank: dialog.account.is_bank,
                    }
                  : {
                      ...emptyValues,
                      parentId: dialog.parentId ?? "",
                      accountType:
                        groupOptions.find((p) => p.id === dialog.parentId)?.account_type ?? "asset",
                    }
              }
              submitLabel={dialog.mode === "edit" ? "Save changes" : "Add account"}
              onSubmit={async (values) => {
                const result =
                  dialog.mode === "edit"
                    ? await updateAccount(dialog.account.id, values)
                    : await createAccount(values);
                if (!result?.error) {
                  toast.success(dialog.mode === "edit" ? "Account updated" : "Account created");
                  setDialog(null);
                }
                return result;
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
