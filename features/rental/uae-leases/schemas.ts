import { z } from "zod";

export const uaeLeaseSchema = z
  .object({
    assetId: z.string().uuid("Select an asset"),
    tenantId: z.string().uuid("Select a tenant"),
    leaseStart: z.string().date("Enter a valid date"),
    leaseEnd: z.string().date("Enter a valid date"),
    rentalAmount: z.coerce.number().positive("Must be greater than zero"),
    rentCycle: z.enum(["monthly", "yearly"], { message: "Select a rent cycle" }),
    securityDeposit: z.coerce.number().nonnegative(),
    currencyId: z.string().uuid("Select a currency"),
  })
  .refine((d) => d.leaseEnd > d.leaseStart, {
    message: "Lease end must be after lease start",
    path: ["leaseEnd"],
  });

export type UaeLeaseInput = z.output<typeof uaeLeaseSchema>;
export type UaeLeaseFormValues = z.input<typeof uaeLeaseSchema>;
