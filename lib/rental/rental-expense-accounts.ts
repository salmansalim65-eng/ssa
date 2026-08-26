import { createClient } from "@/lib/supabase/server";

export interface RentalExpenseAccount {
  id: string;
  account_code: string;
  account_name: string;
}

// Expense accounts a rent invoice can charge: the non-group accounts sitting
// under the Chart-of-Accounts "Rental Expenses" group. Matches the group name
// loosely (RENTAL / RENTEL / RENT EXPENSE(S), any surrounding words) and
// collects children at any depth beneath it. Empty only when no such
// group/accounts exist yet.
export async function loadRentalExpenseAccounts(companyId: string): Promise<RentalExpenseAccount[]> {
  const supabase = await createClient();
  const { data: allAccounts } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_code, account_name, parent_id, is_group")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("account_code");
  const rows = allAccounts ?? [];

  const groups = rows.filter((r) => /rent[a-z]*\s*expense/i.test(String(r.account_name ?? "")));
  const groupNode = groups.find((r) => r.is_group) ?? groups[0];
  if (!groupNode) return [];

  const childrenByParent = new Map<string, typeof rows>();
  for (const r of rows) {
    const p = r.parent_id as string | null;
    if (!p) continue;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(r);
  }
  const out: RentalExpenseAccount[] = [];
  const stack = [...(childrenByParent.get(groupNode.id as string) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.is_group) {
      stack.push(...(childrenByParent.get(node.id as string) ?? []));
    } else {
      out.push({
        id: node.id as string,
        account_code: node.account_code as string,
        account_name: node.account_name as string,
      });
    }
  }
  return out.sort((a, b) => a.account_code.localeCompare(b.account_code));
}
