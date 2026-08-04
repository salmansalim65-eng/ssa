"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

  const childrenByParent = useMemo(() => {
    const map = new Map<string, AccountRow[]>();
    for (const a of accounts) {
      const key = a.parent_id ?? "__root__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    for (const list of map.values()) list.sort((a, b) => a.account_code.localeCompare(b.account_code));
    return map;
  }, [accounts]);

  const groupOptions: ParentOption[] = accounts
    .filter((a) => a.is_group)
    .map((a) => ({ id: a.id, account_code: a.account_code, account_name: a.account_name, account_type: a.account_type }));

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      const hasChildren = (childrenByParent.get(account.id) ?? []).length > 0;
      const isExpanded = expanded.has(account.id);

      const row = (
        <div
          key={account.id}
          className="flex items-center gap-2 border-b py-2 pr-2 last:border-0"
          style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(account.id)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDownIcon className="size-4" />
              ) : (
                <ChevronRightIcon className="size-4" />
              )}
            </button>
          ) : (
            <span className="inline-block size-4" />
          )}

          <span className="w-24 shrink-0 font-mono text-sm">{account.account_code}</span>
          <span className={account.is_group ? "font-medium" : ""}>{account.account_name}</span>

          <Badge variant="outline" className="ml-2 capitalize">
            {account.account_type}
          </Badge>
          {account.currency_code && <Badge variant="secondary">{account.currency_code}</Badge>}
          {account.is_group && <Badge>Group</Badge>}
          {account.is_cash && <Badge variant="outline">Cash</Badge>}
          {account.is_bank && <Badge variant="outline">Bank</Badge>}
          {!account.is_active && <Badge variant="secondary">Inactive</Badge>}

          {!account.is_group && (
            <span className="ml-auto text-sm text-muted-foreground">
              {account.opening_balance.toLocaleString()}
            </span>
          )}

          {(canCreate || canEdit || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="ml-2" disabled={isPending}>
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canCreate && account.is_group && (
                  <DropdownMenuItem onSelect={() => setDialog({ mode: "create", parentId: account.id })}>
                    Add child account
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
        </div>
      );

      return isExpanded ? [row, ...renderRows(account.id, depth + 1)] : [row];
    });
  }

  return (
    <div className="space-y-3">
      {canCreate && (
        <Button size="sm" onClick={() => setDialog({ mode: "create", parentId: null })}>
          <PlusIcon /> Add root account
        </Button>
      )}

      <div className="rounded-md border">
        {accounts.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">No accounts yet.</p>
        ) : (
          renderRows("__root__", 0)
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "edit" ? "Edit account" : "Add account"}
            </DialogTitle>
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
