import { z } from "zod";

// One monthly expense on an HH lease property: an expense ACCOUNT (from the
// "Rental Expenses" Chart-of-Accounts group) and its monthly amount. When the
// HH invoice posts, each expense books Dr <account> / Cr <tenant>. Blank rows
// (no account / zero amount) are dropped by the create action, so the account
// is optional at the schema level.
export const hhLeaseExpenseSchema = z.object({
  accountId: z.string().uuid("Select an expense account").optional().or(z.literal("")),
  amount: z.coerce.number().nonnegative("Must be zero or more").optional(),
});

// One asset line of the HH Lease voucher grid. Each line is materialised as
// its own rental.uae_leases row, all sharing the voucher's document number.
export const hhLeaseLineSchema = z
  .object({
    assetId: z.string().uuid("Select an asset"),
    rentalAmount: z.coerce.number().positive("Must be greater than zero"),
    leaseStart: z.string().date("Enter a valid date"),
    leaseEnd: z.string().date("Enter a valid date"),
    // Named monthly other-expenses for this property; each feeds the Rent Balance
    // report's Other Expenses column and reduces the owner's balance rent.
    expenses: z.array(hhLeaseExpenseSchema).optional().default([]),
    remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().or(z.literal("")),
  })
  .refine((d) => d.leaseEnd > d.leaseStart, {
    message: "Lease end must be after lease start",
    path: ["leaseEnd"],
  });

export const hhLeaseSchema = z.object({
  tenantId: z.string().uuid("Select a tenant"),
  documentDate: z.string().date("Enter a valid date"),
  currencyId: z.string().uuid("Select a currency"),
  rentCycle: z.enum(["monthly", "yearly"], { message: "Select a rent cycle" }),
  lines: z.array(hhLeaseLineSchema).min(1, "Add at least one asset line"),
});

export type HhLeaseInput = z.output<typeof hhLeaseSchema>;
export type HhLeaseFormValues = z.input<typeof hhLeaseSchema>;
