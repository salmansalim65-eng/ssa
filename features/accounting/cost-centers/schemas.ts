import { z } from "zod";

export const RENTAL_STATUSES = ["vacant", "occupied", "under_maintenance", "not_applicable"] as const;

export const costCenterSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(2, "Name is required").max(200),
  country: z.string().max(100).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  propertyType: z.string().max(100).optional().or(z.literal("")),
  building: z.string().max(200).optional().or(z.literal("")),
  plotNumber: z.string().max(100).optional().or(z.literal("")),
  owner: z.string().max(200).optional().or(z.literal("")),
  rentalStatus: z.enum(RENTAL_STATUSES),
});

export type CostCenterInput = z.infer<typeof costCenterSchema>;
