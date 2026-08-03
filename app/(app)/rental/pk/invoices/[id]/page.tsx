import { notFound } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RecordPkRentPaymentForm } from "@/components/rental/record-pk-rent-payment-form";
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { postPkRentInvoice } from "@/features/rental/pk-rent-invoices/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getVoucherApproval } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

const utilityTypeLabels = { electricity: "Electricity", gas: "Gas", water: "Water", other: "Other" } as const;

export default async function PkRentInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: invoice }, canSubmit, canApprove, canReject, canPost, canRecordPayment] = await Promise.all([
    supabase
      .schema("rental")
      .from("pk_rent_invoices")
      .select(
        "*, pk_leases:lease_id(assets:asset_id(asset_code, asset_name), tenants:tenant_id(name)), currencies:currency_id(code), journal_entries:journal_entry_id(status)",
      )
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("pk_rent_invoice", "edit"),
    hasPermission("pk_rent_invoice", "approve"),
    hasPermission("pk_rent_invoice", "reject"),
    hasPermission("pk_rent_invoice", "post"),
    hasPermission("pk_rent_invoice", "create"),
  ]);

  if (!invoice) notFound();

  type Refs = {
    pk_leases: {
      assets: { asset_code: string; asset_name: string } | null;
      tenants: { name: string } | null;
    } | null;
    currencies: { code: string } | null;
    journal_entries: { status: JournalEntryStatus } | null;
  };
  const refs = invoice as unknown as Refs;
  const status = refs.journal_entries?.status ?? "draft";

  const approval = await getVoucherApproval("pk_rent_invoice", id);

  const [{ data: utilityCharges }, { data: payments }, { data: accounts }] = await Promise.all([
    supabase.schema("rental").from("pk_utility_charges").select("id, utility_type, amount, description").eq("invoice_id", id),
    supabase
      .schema("rental")
      .from("pk_rent_payments")
      .select("id, payment_date, amount, chart_of_accounts:cash_bank_account_id(account_code, account_name)")
      .eq("invoice_id", id)
      .order("payment_date", { ascending: false }),
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name")
      .eq("company_id", companyId)
      .eq("is_group", false)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("account_code"),
  ]);

  type PaymentRow = {
    id: string;
    payment_date: string;
    amount: number;
    chart_of_accounts: { account_code: string; account_name: string } | null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pakistan Rent Invoice</h1>
          <p className="font-mono text-sm text-muted-foreground">{invoice.voucher_no ?? "Draft"}</p>
        </div>
        <VoucherStatusBadge status={status} />
      </div>

      <div className="grid gap-x-8 gap-y-2 rounded-md border p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Asset</p>
          <p>
            {refs.pk_leases?.assets ? `${refs.pk_leases.assets.asset_code} — ${refs.pk_leases.assets.asset_name}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Tenant</p>
          <p>{refs.pk_leases?.tenants?.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Invoice date</p>
          <p>{invoice.invoice_date}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Due date</p>
          <p>{invoice.due_date}</p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Rent</TableCell>
            <TableCell className="text-right">{invoice.rent_amount.toLocaleString()}</TableCell>
          </TableRow>
          {(utilityCharges ?? []).map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                {utilityTypeLabels[u.utility_type as keyof typeof utilityTypeLabels]}
                {u.description ? ` — ${u.description}` : ""}
              </TableCell>
              <TableCell className="text-right">{u.amount.toLocaleString()}</TableCell>
            </TableRow>
          ))}
          {invoice.advance_adjusted > 0 && (
            <TableRow>
              <TableCell>Advance rent adjusted</TableCell>
              <TableCell className="text-right">-{invoice.advance_adjusted.toLocaleString()}</TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell className="font-medium">Total ({refs.currencies?.code})</TableCell>
            <TableCell className="text-right font-medium">{invoice.total_amount.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Outstanding</TableCell>
            <TableCell className="text-right font-medium">{invoice.outstanding_amount.toLocaleString()}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <VoucherActions
        status={status}
        voucherType="pk_rent_invoice"
        voucherId={invoice.id}
        journalEntryId={invoice.journal_entry_id}
        amount={invoice.total_amount}
        approvalId={approval?.id ?? null}
        canSubmit={canSubmit}
        canApprove={canApprove}
        canReject={canReject}
        canPost={canPost}
        onPost={postPkRentInvoice}
      />

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Payments</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {((payments as unknown as PaymentRow[]) ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.payment_date}</TableCell>
                <TableCell>
                  {p.chart_of_accounts ? `${p.chart_of_accounts.account_code} — ${p.chart_of_accounts.account_name}` : "—"}
                </TableCell>
                <TableCell className="text-right">{p.amount.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {((payments as unknown as PaymentRow[]) ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No payments recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {status === "posted" && invoice.outstanding_amount > 0 && canRecordPayment && (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Record payment</h2>
          <RecordPkRentPaymentForm invoiceId={invoice.id} accounts={accounts ?? []} />
        </div>
      )}
    </div>
  );
}
