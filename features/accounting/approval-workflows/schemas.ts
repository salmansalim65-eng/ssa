import { z } from "zod";

export const stepSchema = z.object({
  approverRoleId: z.string().uuid("Select a role"),
  minAmount: z
    .string()
    .refine((v) => v === "" || !Number.isNaN(Number(v)), "Must be a number")
    .optional()
    .default(""),
  maxAmount: z
    .string()
    .refine((v) => v === "" || !Number.isNaN(Number(v)), "Must be a number")
    .optional()
    .default(""),
});

export type StepInput = z.output<typeof stepSchema>;
export type StepFormValues = z.input<typeof stepSchema>;
