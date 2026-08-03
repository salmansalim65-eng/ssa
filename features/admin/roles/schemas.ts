import { z } from "zod";

export const roleSchema = z.object({
  name: z.string().min(2, "Role name is required").max(100),
  description: z.string().max(500).optional().or(z.literal("")),
});

export type RoleInput = z.infer<typeof roleSchema>;
