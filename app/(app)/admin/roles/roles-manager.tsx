"use client";

import { useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteRole } from "@/features/admin/roles/actions";
import { CreateRoleDialog } from "./create-role-dialog";
import { PermissionMatrix, type PermissionRow } from "./permission-matrix";

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system_role: boolean;
}

export function RolesManager({
  roles,
  permissions,
  grantsByRole,
  canCreate,
  canEdit,
  canDelete,
}: {
  roles: Role[];
  permissions: PermissionRow[];
  grantsByRole: Record<string, Record<string, boolean>>;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [activeRoleId, setActiveRoleId] = useState(roles[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  if (roles.length === 0) {
    return canCreate ? <CreateRoleDialog /> : <p className="text-sm text-muted-foreground">No roles yet.</p>;
  }

  return (
    <Tabs value={activeRoleId} onValueChange={setActiveRoleId}>
      <div className="flex items-center justify-between gap-2">
        <TabsList className="flex-wrap justify-start">
          {roles.map((role) => (
            <TabsTrigger key={role.id} value={role.id}>
              {role.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {canCreate && <CreateRoleDialog />}
      </div>

      {roles.map((role) => (
        <TabsContent key={role.id} value={role.id} className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {role.description || "No description"}
            </p>
            {canDelete && !role.is_system_role && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteRole(role.id, role.is_system_role);
                    if (result?.error) toast.error(result.error);
                    else toast.success("Role deleted");
                  })
                }
              >
                <Trash2Icon /> Delete role
              </Button>
            )}
          </div>
          <PermissionMatrix
            roleId={role.id}
            permissions={permissions}
            initialGrants={grantsByRole[role.id] ?? {}}
            canEdit={canEdit}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
