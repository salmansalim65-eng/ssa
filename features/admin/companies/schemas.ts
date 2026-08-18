import { z } from "zod";

export const updateCompanySchema = z.object({
  name: z.string().min(2, "Company name is required"),
  country: z.enum(["PK", "AE"], { message: "Select a country" }),
  address: z.string().max(500).optional().or(z.literal("")),
  // Date the company's books begin (YYYY-MM-DD); optional.
  accountingPeriodStart: z.string().date("Enter a valid date").optional().or(z.literal("")),
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
