/**
 * The two accounts the Expense KHI float lives on.
 *
 * Names, not ids: an id pasted into source survives no database restore, and
 * would then be silently wrong. Renaming an account is how these get pointed
 * somewhere else. Both the dashboard card and the Expense Voucher form resolve
 * through here, so they can never drift apart.
 */
export const EXPENSE_KHI_BANK_ACCOUNT = "UZMA MEEZAAN BANK";
export const EXPENSE_KHI_EXPENSE_GROUP = "KHI EXPENSE";

/** A chart-of-accounts row, as little of it as this resolution needs. */
export type ChartAccountRow = {
  id: string;
  parent_id: string | null;
  account_name: string | null;
};

/** Case- and spacing-insensitive, so "Khi  Expense" in the tree still matches. */
export function sameAccountName(name: string | null | undefined, wanted: string) {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase() === wanted.toLowerCase();
}

/**
 * The float bank account, and every account under the KHI EXPENSE group.
 *
 * The group is a heading, not a posting account — the spend sits on its
 * children (and theirs), so the whole subtree is walked. `expenseIds` holds the
 * group itself too, which is harmless for a ledger filter and is filtered out
 * where a postable account is wanted. A missing name yields nothing rather than
 * a wrong total, so callers can say so instead of showing a plausible zero.
 */
export function resolveExpenseKhiAccounts(rows: ChartAccountRow[]): {
  bankId: string | null;
  expenseIds: Set<string>;
} {
  const bankId = rows.find((a) => sameAccountName(a.account_name, EXPENSE_KHI_BANK_ACCOUNT))?.id ?? null;
  const groupId = rows.find((a) => sameAccountName(a.account_name, EXPENSE_KHI_EXPENSE_GROUP))?.id ?? null;

  const expenseIds = new Set<string>();
  if (!groupId) return { bankId, expenseIds };

  const childrenOf = new Map<string, string[]>();
  for (const a of rows) {
    if (!a.parent_id) continue;
    const kids = childrenOf.get(a.parent_id);
    if (kids) kids.push(a.id);
    else childrenOf.set(a.parent_id, [a.id]);
  }
  const stack = [groupId];
  while (stack.length) {
    const id = stack.pop()!;
    if (expenseIds.has(id)) continue;
    expenseIds.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return { bankId, expenseIds };
}
