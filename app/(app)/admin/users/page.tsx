import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { InviteUserDialog } from "./invite-user-dialog";
import { UserRowActions } from "./user-row-actions";

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: memberships }, { data: roles }, canCreate, canEdit, canDelete] =
    await Promise.all([
      supabase
        .schema("core")
        .from("user_companies")
        .select("user_id, user_profiles:user_id(id, full_name, email, is_active)")
        .eq("company_id", companyId),
      supabase.schema("core").from("roles").select("id, name").eq("company_id", companyId),
      hasPermission("users", "create"),
      hasPermission("users", "edit"),
      hasPermission("users", "delete"),
    ]);

  const { data: userRoles } = await supabase
    .schema("core")
    .from("user_roles")
    .select("user_id, role_id")
    .eq("company_id", companyId);

  const roleByUser = new Map(userRoles?.map((ur) => [ur.user_id, ur.role_id]));
  const roleNameById = new Map(roles?.map((r) => [r.id, r.name]));

  type MembershipRow = {
    user_id: string;
    user_profiles: { id: string; full_name: string; email: string; is_active: boolean } | null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Everyone with access to this company.
          </p>
        </div>
        {canCreate && <InviteUserDialog roles={roles ?? []} />}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(memberships as unknown as MembershipRow[] | null)?.map((m) => {
            const profile = m.user_profiles;
            if (!profile) return null;
            const roleId = roleByUser.get(profile.id) ?? null;
            return (
              <TableRow key={profile.id}>
                <TableCell className="font-medium">{profile.full_name}</TableCell>
                <TableCell>{profile.email}</TableCell>
                <TableCell>{roleId ? roleNameById.get(roleId) : "—"}</TableCell>
                <TableCell>
                  <Badge variant={profile.is_active ? "success" : "secondary"}>
                    {profile.is_active ? "Active" : "Disabled"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <UserRowActions
                    userId={profile.id}
                    email={profile.email}
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
    </div>
  );
}
