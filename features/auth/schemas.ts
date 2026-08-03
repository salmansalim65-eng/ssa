import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const bootstrapCompanySchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  companyCode: z
    .string()
    .min(2, "Company code is required")
    .max(20)
    .regex(/^[A-Z0-9-]+$/, "Use uppercase letters, numbers, and hyphens only"),
  country: z.enum(["PK", "AE"], { message: "Select a country" }),
});

export type BootstrapCompanyInput = z.infer<typeof bootstrapCompanySchema>;
