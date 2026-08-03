import { z } from "zod";

import { VOUCHER_TYPES } from "@/lib/vouchers/meta";

export const documentSequenceSchema = z.object({
  voucherType: z.enum(VOUCHER_TYPES),
  prefix: z
    .string()
    .min(1, "Prefix is required")
    .max(10)
    .regex(/^[A-Z0-9]+$/, "Uppercase letters and numbers only"),
  padding: z.coerce.number().int().min(1).max(12),
  resetPolicy: z.enum(["never", "yearly", "monthly"]),
});

export type DocumentSequenceInput = z.output<typeof documentSequenceSchema>;
export type DocumentSequenceFormValues = z.input<typeof documentSequenceSchema>;
