"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon, MoreHorizontalIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  assignRole,
  removeUserFromCompany,
  setUserActive,
  setUserPassword,
  updateUser,
} from "@/features/admin/users/actions";
import {
  setPasswordSchema,
  updateUserSchema,
  type SetPasswordInput,
  type UpdateUserInput,
} from "@/features/admin/users/schemas";

export function UserRowActions({
  userId,
  fullName,
  username,
  phone,
  isActive,
  currentRoleId,
  roles,
  canEdit,
  canDelete,
}: {
  userId: string;
  email: string;
  fullName: string;
  username: string | null;
  phone: string | null;
  isActive: boolean;
  currentRoleId: string | null;
  roles: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [pendingRoleId, setPendingRoleId] = useState(currentRoleId ?? "");
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Reveals what is being TYPED here, so a password set for someone else can be
  // read back before it is handed over. Nothing stored is ever shown: the
  // database keeps a one-way hash, so an existing password cannot be displayed
  // by this screen or any other.
  const [showPassword, setShowPassword] = useState(false);

  const editForm = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { fullName, username: username ?? "", phone: phone ?? "" },
  });

  const passwordForm = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  function onPasswordSubmit(values: SetPasswordInput) {
    startTransition(async () => {
      const result = await setUserPassword(userId, values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Password updated");
      passwordForm.reset({ password: "", confirmPassword: "" });
                setShowPassword(false);
      setPasswordOpen(false);
    });
  }

  function run(action: () => Promise<{ error?: string } | undefined>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) toast.error(result.error);
      else toast.success(successMessage);
    });
  }

  function onEditSubmit(values: UpdateUserInput) {
    startTransition(async () => {
      const result = await updateUser(userId, values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Profile updated");
      setEditOpen(false);
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
            <DropdownMenuItem
              onSelect={() => {
                editForm.reset({ fullName, username: username ?? "", phone: phone ?? "" });
                setEditOpen(true);
              }}
            >
              Edit profile
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onSelect={() => setRoleDialogOpen(true)}>
              Change role
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem
              onSelect={() => router.push(`/admin/users/${userId}/permissions`)}
            >
              Permissions
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
              onSelect={() => {
                passwordForm.reset({ password: "", confirmPassword: "" });
                setShowPassword(false);
                setPasswordOpen(true);
              }}
            >
              Set password
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={isPending}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set password — {fullName}</DialogTitle>
          </DialogHeader>
          <Form {...passwordForm}>
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
              <FormField
                control={passwordForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          className="pr-10"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={isPending}>
                  Update password
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
