"use client";

import { useState, useTransition } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  assignRole,
  removeUserFromCompany,
  sendPasswordReset,
  setUserActive,
} from "@/features/admin/users/actions";

export function UserRowActions({
  userId,
  email,
  isActive,
  currentRoleId,
  roles,
  canEdit,
  canDelete,
}: {
  userId: string;
  email: string;
  isActive: boolean;
  currentRoleId: string | null;
  roles: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [pendingRoleId, setPendingRoleId] = useState(currentRoleId ?? "");

  function run(action: () => Promise<{ error?: string } | undefined>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) toast.error(result.error);
      else toast.success(successMessage);
    });
  }

  if (!canEdit && !canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={isPending}>
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onSelect={() => setRoleDialogOpen(true)}>
              Change role
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem
              onSelect={() => run(() => setUserActive(userId, !isActive), isActive ? "User disabled" : "User enabled")}
            >
              {isActive ? "Disable user" : "Enable user"}
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem
              onSelect={() => run(() => sendPasswordReset(email), "Password reset email sent")}
            >
              Reset password
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => run(() => removeUserFromCompany(userId), "User removed from company")}
              >
                Remove from company
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
          </DialogHeader>
          <Select value={pendingRoleId} onValueChange={setPendingRoleId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              disabled={!pendingRoleId || isPending}
              onClick={() =>
                run(async () => {
                  const result = await assignRole(userId, pendingRoleId);
                  if (!result?.error) setRoleDialogOpen(false);
                  return result;
                }, "Role updated")
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
