"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowDownUpIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
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
import { blankAmount } from "@/lib/forms/amount";
import {
  createAccount,
  deleteAccount,
  moveAccount,
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
  is_tenant_group: boolean;
  sort_order: number;
  balance: number;
  id_number: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  country: string | null;
}

type SortMode = "manual" | "name_asc" | "name_desc" | "code" | "balance_desc" | "balance_asc";

const SORT_LABELS: Record<SortMode, string> = {
  manual: "Manual order",
  name_asc: "Name A–Z",
  name_desc: "Name Z–A",
  code: "Account code",
  balance_desc: "Balance high→low",
  balance_asc: "Balance low→high",
};

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
  openingBalance: blankAmount,
  isCash: false,
  isBank: false,
  isTenantGroup: false,
  idNumber: "",
  contactPerson: "",
  phone: "",
  email: "",
  country: "",
};

const typeBadgeClass: Record<AccountRow["account_type"], string> = {
  asset: "border-info/30 bg-info/10 text-info",
  liability: "border-warning/30 bg-warning/10 text-warning",
  equity: "border-primary/30 bg-primary/10 text-primary",
  income: "border-success/30 bg-success/10 text-success",
  expense: "border-destructive/30 bg-destructive/10 text-destructive",
};

// Logo-blue group tint that steps down by level so each depth reads distinctly.
// Full literal class strings keep them in Tailwind's JIT output.
const GROUP_TINTS = [
  "bg-group/[0.16] hover:bg-group/[0.20]",
  "bg-group/[0.10] hover:bg-group/[0.14]",
  "bg-group/[0.06] hover:bg-group/[0.10]",
  "bg-group/[0.04] hover:bg-group/[0.08]",
] as const;
function groupTintClass(depth: number): string {
  return GROUP_TINTS[Math.min(depth, GROUP_TINTS.length - 1)];
}

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
  countries,
  canCreate,
  canEdit,
  canDelete,
}: {
  accounts: AccountRow[];
  currencies: CurrencyOption[];
  countries: { code: string; name: string }[];
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
  const [sortMode, setSortMode] = useState<SortMode>("manual");

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

  // Group by parent, and roll each group's balance up from its descendants
  // (leaf balances come from the ledger; groups don't post directly).
  const { childrenByParent, parentById, rolledBalance } = useMemo(() => {
    const childrenByParent = new Map<string, AccountRow[]>();
    const parentById = new Map<string, string | null>();
    for (const a of accounts) {
      const key = a.parent_id ?? "__root__";
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(a);
      parentById.set(a.id, a.parent_id);
    }
    const rolledBalance = new Map<string, number>();
    const roll = (id: string, own: number): number => {
      const kids = childrenByParent.get(id) ?? [];
      const total = kids.reduce((s, k) => s + roll(k.id, k.balance), own);
      rolledBalance.set(id, total);
      return total;
    };
    for (const a of accounts) if (!rolledBalance.has(a.id)) roll(a.id, a.balance);
    return { childrenByParent, parentById, rolledBalance };
  }, [accounts]);

  // Sibling ordering for the chosen sort mode. "Manual" honors sort_order (with
  // account_code as a stable tiebreaker); the others are view-only.
  const orderedChildren = useMemo(() => {
    const compare = (a: AccountRow, b: AccountRow): number => {
      switch (sortMode) {
        case "name_asc":
          return a.account_name.localeCompare(b.account_name);
        case "name_desc":
          return b.account_name.localeCompare(a.account_name);
        case "code":
          return a.account_code.localeCompare(b.account_code);
        case "balance_desc":
          return Math.abs(rolledBalance.get(b.id) ?? 0) - Math.abs(rolledBalance.get(a.id) ?? 0);
        case "balance_asc":
          return Math.abs(rolledBalance.get(a.id) ?? 0) - Math.abs(rolledBalance.get(b.id) ?? 0);
        default:
          return a.sort_order - b.sort_order || a.account_code.localeCompare(b.account_code);
      }
    };
    const ordered = new Map<string, AccountRow[]>();
    for (const [key, list] of childrenByParent) ordered.set(key, list.slice().sort(compare));
    return ordered;
  }, [childrenByParent, rolledBalance, sortMode]);

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

  const canReorder = canEdit && sortMode === "manual" && !filtersActive;

  // `guides` carries, for each distant-ancestor column (all but the immediate
  // parent), whether a vertical rail should continue through this row — i.e. that
  // ancestor still has siblings below it. This is what turns the indentation into
  // a genuine ├─ / └─ tree instead of free-floating pips.
  function renderRows(parentKey: string, depth: number, guides: boolean[]): ReactNode[] {
    const siblings = orderedChildren.get(parentKey) ?? [];
    const visibleRows = visibleIds ? siblings.filter((a) => visibleIds.has(a.id)) : siblings;
    return visibleRows.flatMap((account, siblingIndex) => {
      const children = orderedChildren.get(account.id) ?? [];
      const visibleChildren = visibleIds
        ? children.filter((c) => visibleIds.has(c.id))
        : children;
      const hasChildren = visibleChildren.length > 0;
      const isExpanded = filtersActive ? true : expanded.has(account.id);
      const isGroup = account.is_group;
      const isFirstSibling = siblingIndex === 0;
      const isLastSibling = siblingIndex === visibleRows.length - 1;

      const row = (
        <TableRow
          key={account.id}
          className={cn(
            "group",
            // Group rows carry a logo-blue tint that steps down level by level, so
            // depth reads at a glance; posting rows stay on the plain card surface.
            isGroup ? groupTintClass(depth) : "hover:bg-muted/30",
            !account.is_active && "opacity-70",
          )}
        >
          {/* Account code + tree connector rails */}
          <td className="p-0 align-middle">
            <div className="flex items-stretch">
              {/* One fixed-width rail column per ancestor level. Distant-ancestor
                  columns draw a full-height vertical line when that branch
                  continues below; the immediate-parent column draws the ├─/└─
                  elbow into this node. Full-height segments meet across rows, so
                  the hierarchy reads as one connected tree. */}
              {Array.from({ length: depth }).map((_, i) => {
                const isElbow = i === depth - 1;
                return (
                  <span key={i} aria-hidden className="relative w-5 shrink-0 self-stretch">
                    {!isElbow && guides[i] && (
                      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-tree-guide" />
                    )}
                    {isElbow && (
                      <>
                        <span
                          className={cn(
                            "absolute left-1/2 w-px -translate-x-1/2 bg-tree-guide",
                            isLastSibling ? "top-0 h-1/2" : "inset-y-0",
                          )}
                        />
                        <span className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2 bg-tree-guide" />
                      </>
                    )}
                  </span>
                );
              })}
              {/* Node: expand toggle, folder/file icon, code */}
              <div className={cn("flex flex-1 items-center py-2 pr-3", depth === 0 ? "pl-3" : "pl-1.5")}>
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
            </div>
          </td>

          {/* Account name */}
          <td className="p-3 align-middle">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "truncate",
                  isGroup
                    ? depth === 0
                      ? "font-bold uppercase tracking-wide text-group"
                      : "font-semibold text-group"
                    : "font-medium",
                )}
              >
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

          {/* Current balance (rolled up from descendants for group rows) */}
          <td className="p-3 text-right align-middle font-mono text-sm tabular-nums">
            <span className={cn(isGroup && "font-semibold text-group")}>
              {formatMoney(rolledBalance.get(account.id) ?? 0)}
            </span>
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
                  {canReorder && (
                    <>
                      <DropdownMenuItem
                        disabled={isFirstSibling}
                        onSelect={() => run(() => moveAccount(account.id, "up"), "Order updated")}
                      >
                        <ArrowUpIcon className="size-4" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={isLastSibling}
                        onSelect={() => run(() => moveAccount(account.id, "down"), "Order updated")}
                      >
                        <ArrowDownIcon className="size-4" /> Move down
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={isFirstSibling}
                        onSelect={() => run(() => moveAccount(account.id, "top"), "Order updated")}
                      >
                        <ArrowUpToLineIcon className="size-4" /> Move to top
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={isLastSibling}
                        onSelect={() => run(() => moveAccount(account.id, "bottom"), "Order updated")}
                      >
                        <ArrowDownToLineIcon className="size-4" /> Move to bottom
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
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

      // Roots (depth 0) have no rail to their left, so they contribute no guide
      // column; from depth 1 down, each level appends whether it continues below.
      const childGuides = depth === 0 ? [] : [...guides, !isLastSibling];
      return isExpanded ? [row, ...renderRows(account.id, depth + 1, childGuides)] : [row];
    });
  }

  const hasAccounts = accounts.length > 0;
  const bodyRows = renderRows("__root__", 0, []);

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
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger className="w-[11.5rem]" aria-label="Sort accounts">
                <ArrowDownUpIcon className="size-4 opacity-70" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {SORT_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                <TableHead className="w-40 text-right">Balance</TableHead>
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
              countries={countries}
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
                      isTenantGroup: dialog.account.is_tenant_group,
                      idNumber: dialog.account.id_number ?? "",
                      contactPerson: dialog.account.contact_person ?? "",
                      phone: dialog.account.phone ?? "",
                      email: dialog.account.email ?? "",
                      country: dialog.account.country ?? "",
                    }
                  : {
                      ...emptyValues,
                      parentId: dialog.parentId ?? "",
                      accountType:
                        groupOptions.find((p) => p.id === dialog.parentId)?.account_type ?? "asset",
                    }
              }
              submitLabel={dialog.mode === "edit" ? "Save changes" : "Add account"}
              accountId={dialog.mode === "edit" ? dialog.account.id : undefined}
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
