import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatVoucherNo } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { isMissingTable } from "@/lib/my-dashboard/notes-availability";
import { rentMonthLabel } from "@/lib/rental/rent-months";

/** The statements entered so far, newest first. */
export default async function RentStatementsPage() {
  const [canView, canCreate] = await Promise.all([
    hasPermission("rent_statement", "view"),
    hasPermission("rent_statement", "create"),
  ]);
  if (!canView) return null;

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("rental")
    .from("rent_statements")
    .select("id, voucher_no, statement_date, statement_month, total_rent, total_net")
    .eq("company_id", companyId)
    .order("statement_date", { ascending: false });

  const unavailable = isMissingTable(error)
    ? "Rent statements need migration 0144_rent_statement.sql to be run on the database first."
    : (error?.message ?? null);
  const rows = (data ?? []) as {
    id: string;
    voucher_no: string | null;
    statement_date: string;
    statement_month: string;
    total_rent: number;
    total_net: number;
  }[];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rental"
        title="Rent statements"
        description="The letting agent's monthly sheets — short-term and long-term units together."
        backHref="/dashboard"
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link href="/rental/rent-statements/new">
                <PlusIcon /> New statement
              </Link>
            </Button>
          )
        }
      />

      {unavailable ? (
        <p className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">{unavailable}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
          No statements yet.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/rental/rent-statements/${r.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-accent">
                <span className="w-28 shrink-0 font-mono text-xs tabular-nums">
                  {r.voucher_no ? formatVoucherNo(r.voucher_no) : <span className="text-muted-foreground">Draft</span>}
                </span>
                <span className="w-28 shrink-0 text-sm text-muted-foreground">{formatDate(r.statement_date)}</span>
                <span className="min-w-0 flex-1 text-sm font-medium">{rentMonthLabel(r.statement_month)}</span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                  {formatMoney(r.total_rent)} rent
                </span>
                <span className="w-32 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
                  {formatMoney(r.total_net)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
