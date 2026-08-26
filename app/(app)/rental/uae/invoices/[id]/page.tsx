import { notFound } from "next/navigation";
import Link from "next/link";
import { PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EscToBack } from "@/components/vouchers/esc-to-back";
import { RecordRentPaymentForm } from "@/components/rental/record-rent-payment-form";
import { PrintButton } from "@/components/vouchers/print-button";
import { DeletePostedInvoiceButton } from "@/components/rental/delete-posted-invoice-button";
import { EditPostedInvoiceButton } from "@/components/rental/edit-posted-invoice-button";
import { VoucherActions } from "@/components/vouchers/voucher-actions";
import { VoucherDeleteButton } from "@/components/vouchers/voucher-delete-button";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { deleteUaeRentInvoice, postUaeRentInvoice } from "@/features/rental/uae-rent-invoices/actions";
import { hasPermission, isCurrentUserAdmin } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { formatAccountCode, formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId, getVoucherApproval } from "@/lib/vouchers/engine";
import type { JournalEntryStatus } from "@/types/database.types";

export default async function UaeRentInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: invoice }, canSubmit, canApprove, canReject, canPost, canRecordPayment] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_rent_invoices")
      // `uae_leases:lease_id` and its nested `tenants:tenant_id` are same-schema
      // (rental) embeds; the asset (assets), currency (core) and journal entry
      // (accounting) are cross-schema and are hydrated separately below.
      .select("*, uae_leases:lease_id(asset_id, tenants:tenant_id(name))")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle(),
    hasPermission("uae_rent_invoice", "edit"),
    hasPermission("uae_rent_invoice", "approve"),
    hasPermission("uae_rent_invoice", "reject"),
    hasPermission("uae_rent_invoice", "post"),
    hasPermission("uae_rent_invoice", "create"),
  ]);

  if (!invoice) notFound();

  const [canDelete, isAdmin] = await Promise.all([
    hasPermission("uae_rent_invoice", "delete"),
    isCurrentUserAdmin(),
  ]);

  // For a combined (grid) invoice, load every property of the voucher so the
  // detail shows the full multi-property breakdown (like the create form).
  const monthsSpan = (start: string, end: string) => {
    const s = new Date(`${start}T00:00:00`);
    const e = new Date(`${end}T00:00:00`);
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
  };
  let properties: { assetName: string; leaseStart: string; leaseEnd: string; rent: number }[] = [];
  if (!invoice.schedule_id && invoice.lease_id) {
    const { data: firstLease } = await supabase
      .schema("rental")
      .from("uae_leases")
      .select("document_no")
      .eq("id", invoice.lease_id)
      .maybeSingle();
    const docNo = firstLease?.document_no as string | null;
    if (docNo) {
      const { data: voucherLeases } = await supabase
        .schema("rental")
        .from("uae_leases")
        .select("asset_id, rental_amount, lease_start, lease_end")
        .eq("company_id", companyId)
        .eq("document_no", docNo)
        .is("deleted_at", null)
        .order("created_at");
      const vLeases = voucherLeases ?? [];
      const propAssets = await fetchRefs<{ id: string; asset_name: string }>(
        supabase, "assets", "assets", "asset_name", vLeases.map((l) => l.asset_id as string),
      );
      properties = vLeases.map((l) => {
        const months = monthsSpan(l.lease_start as string, l.lease_end as string);
        return {
          assetName: propAssets.get(l.asset_id as string)?.asset_name ?? "—",
          leaseStart: l.lease_start as string,
          leaseEnd: l.lease_end as string,
          rent: Math.round(Number(l.rental_amount) * months * 100) / 100,
        };
      });
    }
  }

  type Refs = {
    uae_leases: {
      assets: { asset_code: string; asset_name: string } | null;
      tenants: { name: string } | null;
    } | null;
    currencies: { code: string } | null;
    journal_entries: { status: JournalEntryStatus } | null;
  };
  const lease = (invoice as unknown as {
    uae_leases: { asset_id: string | null; tenants: { name: string } | null } | null;
  }).uae_leases;

  const [assetsById, currenciesById, journalEntriesById] = await Promise.all([
    fetchRefs<{ id: string; asset_code: string; asset_name: string }>(
      supabase, "assets", "assets", "asset_code, asset_name", [lease?.asset_id],
    ),
    fetchRefs<{ id: string; code: string }>(supabase, "core", "currencies", "code", [invoice.currency_id]),
    fetchRefs<{ id: string; status: JournalEntryStatus }>(
      supabase, "accounting", "journal_entries", "status", [invoice.journal_entry_id],
    ),
  ]);

  const refs: Refs = {
    uae_leases: lease
      ? {
          assets: lease.asset_id ? assetsById.get(lease.asset_id) ?? null : null,
          tenants: lease.tenants,
        }
      : null,
    currencies: currenciesById.get(invoice.currency_id) ?? null,
    journal_entries: invoice.journal_entry_id ? journalEntriesById.get(invoice.journal_entry_id) ?? null : null,
  };
  const status = refs.journal_entries?.status ?? "draft";

  const approval = await getVoucherApproval("uae_rent_invoice", id);

  const [{ data: payments }, { data: accounts }] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_rent_payments")
      .select("id, payment_date, amount, cash_bank_account_id")
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

  type PaymentRaw = { id: string; payment_date: string; amount: number; cash_bank_account_id: string | null };
  const paymentRows = (payments as unknown as PaymentRaw[]) ?? [];
  const paymentAccountsById = await fetchRefs<{ id: string; account_code: string; account_name: string }>(
    supabase, "accounting", "chart_of_accounts", "account_code, account_name",
    paymentRows.map((p) => p.cash_bank_account_id),
  );

  return (
    <div className="space-y-6">
      <EscToBack />
      <PageHeader
        eyebrow="Lease Invoice"
        title={invoice.voucher_no ?? "Draft"}
        backHref="/rental/invoices"
        actions={
          <>
            <Badge variant="outline">{invoice.invoice_type === "HH" ? "HH Invoice" : "UAE Invoice"}</Badge>
            <VoucherStatusBadge status={status} />
            <PrintButton />
            {status === "draft" && canDelete && (
              <VoucherDeleteButton
                id={invoice.id}
                onDelete={deleteUaeRentInvoice}
                listHref={`/rental/uae/leases/${invoice.lease_id}`}
                label="rent invoice"
              />
            )}
            {isAdmin && status === "posted" && (
              <>
                {invoice.schedule_id ? (
                  <EditPostedInvoiceButton
                    invoiceId={invoice.id}
                    country="uae"
                    amount={invoice.amount}
                    dueDate={invoice.due_date}
                    currencyCode={refs.currencies?.code}
                  />
                ) : (
                  // Combined (grid) invoice: edit in the full multi-property form.
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/rental/uae/invoices/${invoice.id}/edit`}>
                      <PencilIcon className="size-4" /> Edit
                    </Link>
                  </Button>
                )}
                <DeletePostedInvoiceButton invoiceId={invoice.id} country="uae" />
              </>
            )}
          </>
        }
      />

      <div className="grid gap-x-8 gap-y-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Asset</p>
          <p className="mt-0.5">
            {refs.uae_leases?.assets ? refs.uae_leases.assets.asset_name : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tenant</p>
          <p className="mt-0.5">{refs.uae_leases?.tenants?.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Period</p>
          <p className="mt-0.5">
            {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due date</p>
          <p className="mt-0.5">{formatDate(invoice.due_date)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</p>
          <p className="mt-0.5 font-mono tabular-nums">
            {formatMoney(invoice.amount)} {refs.currencies?.code}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outstanding balance</p>
          <p className="mt-0.5 font-mono tabular-nums">
            {formatMoney(invoice.outstanding_balance)} {refs.currencies?.code}
          </p>
        </div>
      </div>

      {/* Property breakdown for a combined (grid) invoice */}
      {properties.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Properties</h2>
          <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">Sno</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead className="text-right">Rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((p, i) => (
                  <TableRow key={`${p.assetName}-${i}`}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{p.assetName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(p.leaseStart)} – {formatDate(p.leaseEnd)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(p.rent)} {refs.currencies?.code}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Invoice total */}
      <div className="flex items-center justify-between rounded-xl border-2 border-ledger/40 bg-ledger/10 px-5 py-3">
        <span className="text-sm font-semibold uppercase tracking-wide text-ledger">Total</span>
        <span className="font-mono text-lg font-bold tabular-nums text-foreground">
          {formatMoney(invoice.amount)} {refs.currencies?.code}
        </span>
      </div>

      <div className="print:hidden">
        <VoucherActions
          status={status}
          voucherType="uae_rent_invoice"
          voucherId={invoice.id}
          journalEntryId={invoice.journal_entry_id}
          amount={invoice.amount}
          approvalId={approval?.id ?? null}
          canSubmit={canSubmit}
          canApprove={canApprove}
          canReject={canReject}
          canPost={canPost}
          onPost={postUaeRentInvoice}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Payments</h2>
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paymentRows.map((p) => {
                const acct = p.cash_bank_account_id ? paymentAccountsById.get(p.cash_bank_account_id) ?? null : null;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground">{formatDate(p.payment_date)}</TableCell>
                    <TableCell>{acct ? `${formatAccountCode(acct.account_code)} — ${acct.account_name}` : "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(p.amount)}</TableCell>
                  </TableRow>
                );
              })}
              {paymentRows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No payments recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {status === "posted" && invoice.outstanding_balance > 0 && canRecordPayment && (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Record payment</h2>
          <RecordRentPaymentForm invoiceId={invoice.id} accounts={accounts ?? []} />
        </div>
      )}
    </div>
  );
}
