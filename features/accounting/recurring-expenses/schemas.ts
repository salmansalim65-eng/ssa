import { z } from "zod";

export const RECURRING_FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly"] as const;

export const FREQUENCY_LABELS: Record<(typeof RECURRING_FREQUENCIES)[number], string> = {
  monthly: "Every month",
  quarterly: "Every 3 months",
  half_yearly: "Every 6 months",
  yearly: "Every year",
};

/** How many months apart two occurrences of each frequency are. */
export const FREQUENCY_MONTHS: Record<(typeof RECURRING_FREQUENCIES)[number], number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

export const recurringExpenseSchema = z
  .object({
    name: z.string().min(2, "Name is required").max(200),
    accountId: z.string().uuid().optional().or(z.literal("")),
    costCenterId: z.string().uuid().optional().or(z.literal("")),
    currencyId: z.string().uuid({ message: "Select a currency" }),
    amount: z.coerce.number().positive("Amount must be greater than zero"),
    frequency: z.enum(RECURRING_FREQUENCIES, { message: "Select how often it falls due" }),
    dayOfMonth: z.coerce.number().int().min(1).max(31),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().optional().or(z.literal("")),
    notes: z.string().max(500).optional().or(z.literal("")),
    isActive: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.endDate && val.endDate < val.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "The end date cannot be before the start date.",
      });
    }
  });

export type RecurringExpenseInput = z.output<typeof recurringExpenseSchema>;
export type RecurringExpenseFormValues = z.input<typeof recurringExpenseSchema>;
