import { z } from "zod";

const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30)
  .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, dots, dashes, and underscores only");

export const inviteUserSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  fullName: z.string().min(2, "Full name is required"),
  username: usernameSchema.optional().or(z.literal("")),
  roleId: z.string().uuid("Select a role"),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  username: usernameSchema.optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
