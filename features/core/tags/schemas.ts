import { z } from "zod";

/**
 * A tag is a free label an expense line is filed under — Maintenance, Travel,
 * Utilities — so spend groups across accounts and cost centres. It carries no
 * accounting meaning of its own; that is what makes it useful for cutting the
 * same expenses a different way.
 */
export const tagSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60, "Keep it under 60 characters"),
  description: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type TagInput = z.output<typeof tagSchema>;
export type TagFormValues = z.input<typeof tagSchema>;
