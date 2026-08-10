import { redirect } from "next/navigation";

// UAE and PK invoice lists are consolidated into the unified Rent Invoices page.
// The per-invoice detail/print routes under this folder are still used.
export default function PkRentInvoicesPage() {
  redirect("/rental/invoices");
}
