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
    // Zero is allowed only on a vacant line; the refine below enforces that.
    rentalAmount: z.coerce.number().nonnegative("Must be zero or more"),
    leaseStart: z.string().date("Enter a valid date"),
    leaseEnd: z.string().date("Enter a valid date"),
    // Named monthly other-expenses for this property; each feeds the Rent Balance
    // report's Other Expenses column and reduces the owner's balance rent.
    expenses: z.array(hhLeaseExpenseSchema).optional().default([]),
    // Remarks are optional — an empty string is accepted and stored as NULL.
    remarks: z.string().trim().max(200, "Keep it under 200 characters").optional().default(""),
    // How THIS property's rent falls due (per-property, so one voucher can mix
    // Advance and Monthly). The ledger still books the whole voucher as one entry.
    paymentTerms: z.enum(["advance", "monthly", "quarterly", "half_yearly", "yearly"]).default("monthly"),
    // The property stood empty for this period. It is still a line — the vacancy
    // is recorded with its dates — but it bills nothing and posts nothing.
    vacant: z.boolean().default(false),
  })
  .refine((d) => d.leaseEnd > d.leaseStart, {
    message: "Lease end must be after lease start",
    path: ["leaseEnd"],
  })
  // Zero rent is allowed and means a RENT-FREE letting: the property is
  // occupied, nothing is charged (a fit-out or grace period). That is not the
  // same as Vacant, which means empty — the lease still runs and the property
  // still reads as let everywhere. The line bills nothing and posts nothing.
  ;

export const hhLeaseSchema = z.object({
  tenantId: z.string().uuid("Select a tenant"),
  documentDate: z.string().date("Enter a valid date"),
  // The month the invoice is FOR, as the first of that month — HH is billed one
  // invoice per month, so the month is a fact of the document, not something to
  // be guessed later from the line dates. Optional for the yearly UAE grid,
  // which is not a monthly run.
  rentMonth: z.string().date("Pick a month").optional().or(z.literal("")),
  currencyId: z.string().uuid("Select a currency"),
  rentCycle: z.enum(["monthly", "yearly"], { message: "Select a rent cycle" }),
  lines: z.array(hhLeaseLineSchema).min(1, "Add at least one asset line"),
});

export type HhLeaseInput = z.output<typeof hhLeaseSchema>;
export type HhLeaseFormValues = z.input<typeof hhLeaseSchema>;
