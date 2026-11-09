import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { RentStatementForm, type UnitAlias, type UnitOption } from "@/components/rental/rent-statement-form";
import type { RentStatementFormValues } from "@/features/rental/rent-statements/schemas";
import { monthStart } from "@/lib/rental/rent-months";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { toAccountOptions, type RawAccountRow } from "@/lib/vouchers/account-currency";
import { mapVoucherCurrencies, type RawCompanyCurrency } from "@/lib/vouchers/currencies";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

/**
 * Correcting the agent's monthly sheet before it is posted.
 *
 * The same screen as entering one, filled in. Only a DRAFT comes here: a
 * posted statement's entry is immutable, its bills may already be settled and
 * its number is on reports, so it is deleted and entered again instead.
 */
export default async function EditRentStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasPermission("rent_statement", "edit"))) redirect("/dashboard");

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const [
    { data: accounts },
    { data: companyCurrencies },
    { data: costCenters },
    { data: aliasRows },
    { data: lastStatement },
    { data: receivableRole },
  ] = await Promise.all([
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name, currency_id, country, default_cost_center_id")
      .eq("company_id", companyId)
      .eq("is_group", false)
      .is("deleted_at", null)
      .order("account_code"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, code, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("code"),
    // What the agent's sheet has called each unit before, so an import maps
    // the row without asking again.
    supabase.schema("rental").from("unit_aliases").select("alias, cost_center_id").eq("company_id", companyId),
    // Whose statement the last one was. One agent sends the sheet month after
    // month, so the last answer is almost always this month's too.
    supabase
      .schema("rental")
      .from("rent_statements")
      .select("agent_account_id")
      .eq("company_id", companyId)
      .order("statement_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // And before there is a last one: whoever the rent invoices are already
    // billed to. Read from the posting template rather than named here, so the
    // default follows the configuration instead of a guess baked into the code.
    supabase
      .schema("accounting")
      .from("posting_templates")
      .select("account_id")
      .eq("company_id", companyId)
      .eq("voucher_type", "uae_rent_invoice")
      .eq("account_role", "tenant_receivable")
      .maybeSingle(),
  ]);

  const accountOptions = toAccountOptions((accounts ?? []) as RawAccountRow[]);
  // Base currency first, so the form opens on it.
  const currencyOptions = await mapVoucherCurrencies(
    companyId,
    new Date().toISOString().slice(0, 10),
    companyCurrencies as unknown as RawCompanyCurrency[],
  );
  const units: UnitOption[] = ((costCenters ?? []) as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const aliases: UnitAlias[] = ((aliasRows ?? []) as { alias: string; cost_center_id: string }[]).map((a) => ({
    alias: a.alias,
    costCenterId: a.cost_center_id,
  }));

  // How far each unit is already billed.
  //
  // The agent sends a sheet with a unit on it and no rent against it, and the
  // row says nothing about why: that unit may be billed months ahead already,
  // or he may simply not have filled it in yet. SSA knows which, because it
  // knows the last month it raised a bill for — so the row can say so instead
  // of leaving it to be worked out unit by unit.
  const { billedUpTo, letUntil } = await loadUnitCover(companyId);

  // The statement is written in the agent's own currency — TOP LINE DXB keeps
  // its account in AED, and the company's base is SAR.
  const defaultAgentAccountId =
    (lastStatement?.agent_account_id as string | undefined) ??
    (receivableRole?.account_id as string | undefined) ??
    null;
  const defaultCurrencyId =
    ((accounts ?? []) as { id: string; currency_id: string | null }[]).find(
      (a) => a.id === defaultAgentAccountId,
    )?.currency_id ?? null;

  const { data: statement } = await supabase
    .schema("rental")
    .from("rent_statements")
    .select(
      "id, voucher_no, statement_date, statement_month, agent_account_id, currency_id, exchange_rate, narration, total_net",
    )
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!statement) notFound();
  // A posted statement has a number, bills behind it and an entry nobody can
  // change. Sending it to the form would offer an edit that cannot be saved.
  if (statement.voucher_no) redirect(`/rental/rent-statements/${id}`);

  const { data: lineRows } = await supabase
    .schema("rental")
    .from("rent_statement_lines")
    .select(
      "line_no, line_type, cost_center_id, period_from, period_to, rent_month, months, rent_amount, management_amount, dewa, internet, access_card, wifi, other, remarks",
    )
    .eq("statement_id", id)
    .order("line_no");

  const initial = {
    statementDate: statement.statement_date as string,
    statementMonth: statement.statement_month as string,
    agentAccountId: statement.agent_account_id as string,
    currencyId: statement.currency_id as string,
    exchangeRate: Number(statement.exchange_rate),
    narration: (statement.narration as string | null) ?? "",
    sheetTotalNet: String(statement.total_net ?? ""),
    lines: (lineRows ?? []).map((l) => ({
      lineType: l.line_type as "short_term" | "long_term",
      costCenterId: (l.cost_center_id as string | null) ?? "",
      periodFrom: (l.period_from as string | null) ?? "",
      periodTo: (l.period_to as string | null) ?? "",
      rentMonth: l.rent_month as string,
      months: Number(l.months),
      rentAmount: Number(l.rent_amount),
      managementAmount: Number(l.management_amount),
      dewa: Number(l.dewa),
      internet: Number(l.internet),
      accessCard: Number(l.access_card),
      wifi: Number(l.wifi),
      other: Number(l.other),
      remarks: (l.remarks as string | null) ?? "",
    })),
  } as unknown as RentStatementFormValues;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rental"
        title="Edit rent statement"
        description="A draft, before it reaches the ledger. Everything on it can still be changed."
        backHref={`/rental/rent-statements/${id}`}
      />
      <RentStatementForm
        accounts={accountOptions}
        currencies={currencyOptions}
        units={units}
        aliases={aliases}
        defaultAgentAccountId={defaultAgentAccountId}
        defaultCurrencyId={defaultCurrencyId}
        billedUpTo={billedUpTo}
        letUntil={letUntil}
        statementId={id}
        initial={initial}
      />
    </div>
  );
}

/**
 * How far each unit is accounted for, by cost centre.
 *
 * `billedUpTo` is the last rent month a bill was actually raised for. Both
 * routes count: the statements that raise their own (the unit is on the
 * statement line) and the leases that invoice monthly (the unit is the lease's
 * asset, which the cost centre names).
 *
 * `letUntil` is how far a lease runs with nothing to bill — 106 AYYAN is let
 * to 14 April 2027 on rent taken in full before SSA opened, so the agent lists
 * it every month with nothing against it. Without the lease, the row could
 * only say "never billed", which is true and useless.
 */
async function loadUnitCover(
  companyId: string,
): Promise<{ billedUpTo: Record<string, string>; letUntil: Record<string, string> }> {
  const supabase = await createClient();

  const [{ data: invoices }, { data: lines }, { data: centres }, { data: leases }] = await Promise.all([
    supabase
      .schema("rental")
      .from("uae_rent_invoices")
      .select("period_start, rent_statement_line_id, lease_id")
      .eq("company_id", companyId),
    supabase.schema("rental").from("rent_statement_lines").select("id, cost_center_id"),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, asset_id")
      .eq("company_id", companyId)
      .is("deleted_at", null),
    supabase
      .schema("rental")
      .from("uae_leases")
      .select("id, asset_id, lease_end, is_vacant")
      .is("deleted_at", null),
  ]);

  const centreOfLine = new Map(
    ((lines ?? []) as { id: string; cost_center_id: string | null }[]).map((l) => [l.id, l.cost_center_id]),
  );
  const centreOfAsset = new Map(
    ((centres ?? []) as { id: string; asset_id: string | null }[])
      .filter((c) => c.asset_id)
      .map((c) => [c.asset_id as string, c.id]),
  );
  const leaseRows = (leases ?? []) as {
    id: string;
    asset_id: string | null;
    lease_end: string | null;
    is_vacant: boolean | null;
  }[];
  const assetOfLease = new Map(leaseRows.map((l) => [l.id, l.asset_id]));

  const letUntil: Record<string, string> = {};
  for (const l of leaseRows) {
    if (l.is_vacant || !l.asset_id || !l.lease_end) continue;
    const centre = centreOfAsset.get(l.asset_id);
    if (!centre) continue;
    if (!letUntil[centre] || l.lease_end > letUntil[centre]) letUntil[centre] = l.lease_end;
  }

  const latest: Record<string, string> = {};
  for (const inv of ((invoices ?? []) as {
    period_start: string;
    rent_statement_line_id: string | null;
    lease_id: string | null;
  }[])) {
    const centre = inv.rent_statement_line_id
      ? centreOfLine.get(inv.rent_statement_line_id)
      : inv.lease_id
        ? centreOfAsset.get(assetOfLease.get(inv.lease_id) ?? "")
        : null;
    if (!centre) continue;
    const month = monthStart(inv.period_start);
    if (!latest[centre] || month > latest[centre]) latest[centre] = month;
  }
  return { billedUpTo: latest, letUntil };
}
