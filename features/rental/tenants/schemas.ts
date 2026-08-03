import { z } from "zod";

export const tenantSchema = z.object({
  name: z.string().min(2, "Name is required").max(200),
  idNumber: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
});

export type TenantInput = z.infer<typeof tenantSchema>;
