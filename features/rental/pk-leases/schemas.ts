import { z } from "zod";

export const pkLeaseSchema = z
  .object({
    assetId: z.string().uuid("Select an asset"),
    tenantId: z.string().uuid("Select a tenant"),
    leaseStart: z.string().date("Enter a valid date"),
    leaseEnd: z.string().date("Enter a valid date"),
    monthlyRent: z.coerce.number().positive("Must be greater than zero"),
    advanceRent: z.coerce.number().nonnegative(),
    securityDeposit: z.coerce.number().nonnegative(),
    currencyId: z.string().uuid("Select a currency"),
  })
  .refine((d) => d.leaseEnd > d.leaseStart, {
    message: "Lease end must be after lease start",
    path: ["leaseEnd"],
  });

export type PkLeaseInput = z.output<typeof pkLeaseSchema>;
export type PkLeaseFormValues = z.input<typeof pkLeaseSchema>;
