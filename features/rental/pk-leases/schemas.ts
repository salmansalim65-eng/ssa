import { z } from "zod";

export const pkLeaseSchema = z
  .object({
    assetId: z.string().uuid("Select an asset"),
    tenantId: z.string().uuid("Select a tenant"),
    leaseStart: z.string().date("Enter a valid date"),
    leaseEnd: z.string().date("Enter a valid date"),
    monthlyRent: z.coerce.number().positive("Must be greater than zero"),
    officialRent: z.coerce.number().nonnegative().optional().or(z.literal("")),
    rentCycle: z.enum(["monthly", "quarterly", "yearly"]),
    advanceRent: z.coerce.number().nonnegative(),
    securityDeposit: z.coerce.number().nonnegative(),
    currencyId: z.string().uuid("Select a currency"),
    dueDate: z.string().date("Enter a valid date").optional().or(z.literal("")),
    voucherDate: z.string().date("Voucher date is required"),
    remarks: z.string().trim().min(1, "Remarks are required").max(1000),
  })
  .refine((d) => d.leaseEnd > d.leaseStart, {
    message: "Lease end must be after lease start",
    path: ["leaseEnd"],
  });

export type PkLeaseInput = z.output<typeof pkLeaseSchema>;
export type PkLeaseFormValues = z.input<typeof pkLeaseSchema>;
