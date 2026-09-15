import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { TagManager, type TagRow } from "./tag-manager";

export default async function TagsPage() {
  const [canView, canCreate, canEdit, canDelete] = await Promise.all([
    hasPermission("tags", "view"),
    hasPermission("tags", "create"),
    hasPermission("tags", "edit"),
    hasPermission("tags", "delete"),
  ]);
  if (!canView) redirect("/dashboard");

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const [{ data: rows }, { data: used }] = await Promise.all([
    supabase
      .schema("core")
      .from("tags")
      .select("id, name, description, is_active")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name"),
    // How much has been filed under each tag, so a tag is never deleted blind.
    supabase.schema("accounting").from("expense_voucher_lines").select("tag_id, amount"),
  ]);

  const spendByTag = new Map<string, { count: number; amount: number }>();
  for (const l of (used as { tag_id: string | null; amount: number }[]) ?? []) {
    if (!l.tag_id) continue;
    const t = spendByTag.get(l.tag_id) ?? { count: 0, amount: 0 };
    t.count += 1;
    t.amount += Number(l.amount) || 0;
    spendByTag.set(l.tag_id, t);
  }

  const tags: TagRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? "",
    isActive: r.is_active as boolean,
    usedCount: spendByTag.get(r.id as string)?.count ?? 0,
    usedAmount: spendByTag.get(r.id as string)?.amount ?? 0,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Accounting"
        title="Tags"
        description="Labels an expense line is filed under — Maintenance, Travel, Utilities — so spend groups across accounts and cost centres."
        backHref="/dashboard"
      />
      <TagManager tags={tags} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
