import { z } from "zod";

const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30)
  .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, dots, dashes, and underscores only");

// The ERP creates users directly (username + password). Email is optional and
// not used for login — usernames are resolved to an email under the hood.
export const addUserSchema = z
  .object({
    fullName: z.string().min(2, "Full name is required"),
    username: usernameSchema,
    email: z.string().email("Enter a valid email address").optional().or(z.literal("")),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    roleId: z.string().uuid("Select a role"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type AddUserInput = z.infer<typeof addUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  username: usernameSchema.optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
