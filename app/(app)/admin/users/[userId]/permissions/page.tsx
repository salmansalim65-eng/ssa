import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { PermissionAction } from "@/types/database.types";
import { PermissionMatrix } from "./permission-matrix";

// Fixed column order for the matrix. Every module in the catalog has all nine
// actions; this ordering groups read/write/workflow actions sensibly.
const ACTIONS: PermissionAction[] = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "reject",
  "post",
  "export",
  "print",
];

export default async function UserPermissionsPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  if (!(await hasPermission("users", "edit"))) redirect("/admin/users");

  const supabase = await createClient();

  const { data: companyId } = await supabase.schema("core").rpc("current_company_id");

  const { data: profile } = await supabase
    .schema("core")
    .from("user_profiles")
    .select("id, full_name, username, email")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) notFound();

  const [{ data: catalog }, { data: grants }] = await Promise.all([
    supabase.schema("core").from("permissions").select("module_key, action"),
    supabase
      .schema("core")
      .from("user_permissions")
      .select("module_key, action")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("allowed", true),
  ]);

  const modules = Array.from(
    new Set((catalog ?? []).map((row) => row.module_key)),
  ).sort();

  const initialAllowed = (grants ?? []).map((g) => `${g.module_key}:${g.action}`);

  const fullName = profile.full_name;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Users"
        title="Permissions"
        description={`Configure module permissions for ${fullName}`}
        backHref="/admin/users"
      />

      <PermissionMatrix
        userId={userId}
        modules={modules}
        actions={ACTIONS}
        initialAllowed={initialAllowed}
      />
    </div>
  );
}
