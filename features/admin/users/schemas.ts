import { z } from "zod";

export const inviteUserSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  fullName: z.string().min(2, "Full name is required"),
  roleId: z.string().uuid("Select a role"),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  phone: z.string().max(30).optional().or(z.literal("")),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
