import { UsersIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { AddUserDialog } from "./add-user-dialog";
import { UserRowActions } from "./user-row-actions";

export default async function UsersPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: memberships }, { data: roles }, { data: userRoles }, canCreate, canEdit, canDelete] =
    await Promise.all([
      supabase.schema("core").from("user_companies").select("user_id").eq("company_id", companyId),
      supabase.schema("core").from("roles").select("id, name").eq("company_id", companyId),
      supabase.schema("core").from("user_roles").select("user_id, role_id").eq("company_id", companyId),
      hasPermission("users", "create"),
      hasPermission("users", "edit"),
      hasPermission("users", "delete"),
    ]);

  // Load the member profiles with the service-role client: the RLS-embedded
  // read of core.user_profiles is gated on the viewer's users.view permission
  // and silently returns null for other users, which hid newly-added members.
  // We've already scoped to this company's memberships above, so this is safe.
  const memberIds = (memberships ?? []).map((m) => m.user_id as string);
  const admin = createAdminClient();
  const { data: profiles } = memberIds.length
    ? await admin
        .schema("core")
        .from("user_profiles")
        .select("id, full_name, email, username, phone, is_active")
        .in("id", memberIds)
    : { data: [] };

  const roleByUser = new Map(userRoles?.map((ur) => [ur.user_id, ur.role_id]));
  const roleNameById = new Map(roles?.map((r) => [r.id, r.name]));

  type ProfileRow = {
    id: string;
    full_name: string;
    email: string;
    username: string | null;
    phone: string | null;
    is_active: boolean;
  };

  const rows = ((profiles as unknown as ProfileRow[] | null) ?? []).sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Everyone with access to this company."
        actions={canCreate && <AddUserDialog roles={roles ?? []} />}
      />

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        {rows.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No users yet"
            description="Add users to give them access to this company."
            action={canCreate && <AddUserDialog roles={roles ?? []} />}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((profile) => {
                const roleId = roleByUser.get(profile.id) ?? null;
                return (
                  <TableRow key={profile.id}>
                    <TableCell className="font-medium">{profile.full_name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {profile.username ?? "—"}
                    </TableCell>
                    <TableCell>{profile.email}</TableCell>
                    <TableCell>{roleId ? roleNameById.get(roleId) : "—"}</TableCell>
                    <TableCell>
                      <StatusBadge active={profile.is_active} />
                    </TableCell>
                    <TableCell>
                      <UserRowActions
                        userId={profile.id}
                        email={profile.email}
                        fullName={profile.full_name}
                        username={profile.username}
                        phone={profile.phone}
                        isActive={profile.is_active}
                        currentRoleId={roleId}
                        roles={roles ?? []}
                        canEdit={canEdit}
                        canDelete={canDelete}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
