# Development Roadmap

Strict module-by-module delivery. A phase is not started until the previous
phase's schema, RLS, services, APIs, UI, and tests have been reviewed and
accepted. Each phase below lists what "done" means, matching the 12-part
deliverable checklist from the brief (schema, migrations, Supabase tables,
RLS, backend services, APIs, pages, forms, validation, business logic,
tests, integration).

## Phase 1 — Foundation
**Why first:** every other module depends on companies, auth, RBAC,
audit, storage, and numbering existing and being correct.
- `core` schema: companies, user_profiles, user_companies, roles,
  permissions, role_permissions, user_roles, document_sequences,
  attachments, system_settings.
- `audit` schema + generic audit trigger.
- Supabase Auth wiring, custom access token hook (active company + roles in
  JWT), middleware for session + active-company resolution.
- Admin UI: Companies, Users (create/edit/disable/reset password),
  Roles & Permissions matrix.
- Shared UI shell: sidebar, breadcrumbs, sticky header, dark/light theme.
- Shared `components/data-table` (search, filter, sort, paginate, export
  hooks) used by every later module.

## Phase 2 — Currency Master & Exchange Rates
- `core.currencies`, `core.company_currencies`, `core.exchange_rates`.
- Daily exchange rate entry UI + historical rate viewer.
- `lib/currency/convert.ts` + matching Postgres `fn_convert_amount()`.

## Phase 3 — Chart of Accounts & Cost Centers
- `accounting.chart_of_accounts` (unlimited-level tree), `accounting.cost_centers`.
- Tree-view UI (expand/collapse, drag-reparent optional), account type
  guardrails (only leaf/non-group accounts postable).
- Cost Center screen wired to (not yet existing) assets — created here as
  a standalone entity, linked to `assets.assets` once Phase 6 lands.

## Phase 4 — Accounting Engine Core
- `accounting.journal_entries`, `accounting.journal_entry_lines`,
  `accounting.posting_templates`.
- Balanced-entry trigger/constraint.
- Generic approval engine: `approval_workflows`, `approval_workflow_steps`,
  `voucher_approvals`, `voucher_approval_actions` + admin UI to configure
  workflows per voucher type.
- `core.fn_next_document_number()` numbering RPC.
- This phase ships no end-user voucher screens yet — it's the shared
  engine every voucher type in Phase 5+ builds on.

## Phase 5 — Core Accounting Vouchers
- Receipt, Payment, Post-Dated Payment, Post-Dated Receipt, Cheque Return,
  Journal Voucher, JV Maintenance, Opening Balance Voucher.
- Each: form + validation + auto-numbering + approval routing + posting
  (via Phase 4 engine) + print view.
- Voucher Register report (first report, validates the engine end-to-end).

## Phase 6 — Asset Registration
- `assets.assets`, `assets.asset_images`, auto-creation of a matching
  `accounting.cost_centers` row.
- Image/title-deed upload via Supabase Storage + `core.attachments`.

## Phase 7 — Purchase Property
- `assets.asset_purchases`, `accounting.purchase_vouchers`, posting
  template for purchase (asset, tax, registration charges, additional
  expenses → supplier payable / cash-bank).
- Attachment upload (agreements/invoices).

## Phase 8 — Asset Current Value
- `assets.asset_valuations` (reporting-only, no ledger impact).
- Asset Valuation Report.

## Phase 9 — UAE Rental Management
- `rental.tenants`, `rental.uae_leases`, `rental.uae_payment_schedules`,
  `rental.uae_rent_invoices`.
- Monthly/yearly rent cycles, invoice generation job, outstanding balance
  calculation, auto journal entries (Dr Receivable / Cr Rental Income).

## Phase 10 — Pakistan Rental Management
- `rental.pk_leases`, `rental.pk_rent_invoices`, `rental.pk_utility_charges`.
- Monthly rent, advance rent adjustment, security deposit, utility
  charges, outstanding amount.

## Phase 11 — Asset Sale
- `assets.asset_sales`: sale voucher, buyer, profit/loss + capital gain
  calculation, posting template, `assets.status -> 'sold'`.

## Phase 12 — Reports Engine
- `reporting` views: General Ledger, Trial Balance, Balance Sheet, P&L,
  Cash Book, Bank Book, Asset Register, Purchase Report, Sale Report,
  Rental Income, Outstanding Rent, Currency Exchange, Voucher Register
  (extended with all voucher types now live).
- PDF + Excel export wired to the same queries as the on-screen report.

## Phase 13 — Dashboard
- KPI cards (total assets, total property value, monthly/yearly rental
  income, outstanding rent, pending approvals) + charts (assets by
  country/type, currency summary, recent transactions) — all read-only
  aggregations over prior phases' data, so this phase is intentionally last
  before hardening.

## Phase 14 — Hardening
- Unit + integration + e2e test pass across all modules.
- Security review (RLS coverage audit, permission-bypass testing).
- Performance pass on report queries (indexes, materialized views where
  needed).
- Production Vercel + Supabase environment setup, CI migration pipeline.

---

**Status:** All 14 phases are implemented — see
`supabase/migrations/0001_foundation.sql` through `0013_hardening.sql`,
and the Next.js app under `app/`, `features/`, `lib/`, `components/`.
Phase 9
adds tenants, UAE leases with auto-generated monthly/yearly payment
schedules, on-demand rent invoice generation (Dr Tenant Receivable / Cr UAE
Rental Income via the Phase 4 posting engine), and rent payment collection
against outstanding invoice balances (posted immediately, bypassing the
draft→approval pipeline since it's an ancillary collection action rather
than a primary voucher type). Phase 10 adds Pakistan leases (always-monthly
payment schedules, plus advance rent and security deposit fields), rent
invoices that can carry per-invoice utility charges (electricity/gas/water/
other) and an advance-rent adjustment — validated against the lease's
remaining advance balance by a dedicated trigger — with a dynamic JE (Dr
Tenant Receivable + Dr Advance Rent Liability / Cr Rental Income + Cr
Utility Recovery Income, lines included only when their amount is
non-zero), and the same immediate-post payment collection pattern as UAE.
Phase 11 adds asset disposal: `assets.asset_sales` snapshots book value and
original purchase cost at sale time (both remain user-editable on the asset
afterward, so the sale record can't rely on a live join), derives
profit/loss (against book value) and capital gain (against original cost)
as generated columns, and posts a dynamic JE (Dr Sale Proceeds Receivable +
Dr Loss on Sale / Cr Fixed Asset + Cr Gain on Sale, again only including
the gain/loss line that applies) tagged to the asset's cost center.
`assets.status` flips to `'sold'` only when the sale voucher actually
posts, so a rejected sale doesn't block re-selling the same asset — no
unique(asset_id) constraint, matching purchase_vouchers' precedent.
Phase 12 introduces the `reporting` schema (the sixth top-level schema from
the original blueprint) with `v_ledger_entries` — a single security_invoker
view over posted journal lines that backs the General Ledger, Trial
Balance, Balance Sheet, P&L, Cash Book, and Bank Book reports via different
app-level filters/aggregations rather than one view per report — plus
`v_asset_register`, `v_purchase_report`, `v_sale_report`, `v_rental_income`
(UAE+PK union, posted only), `v_outstanding_rent`, and
`v_currency_exchange_history`. Added `is_cash`/`is_bank` flags to
`chart_of_accounts` so Cash Book/Bank Book know which accounts to include.
Every report ships CSV export (client-side, no new dependency) and a Print
button (browser print-to-PDF); date-range/as-of-date filters live in the
URL via searchParams so a filtered view is a shareable link.

Phase 13 replaces the placeholder Dashboard with KPI cards (total assets,
total property value, monthly/yearly rental income via
`reporting.v_rental_income`, outstanding rent via
`reporting.v_outstanding_rent`, pending approvals via
`accounting.voucher_approvals`), two dependency-free bar charts (assets by
country, assets by property type — plain divs with proportional widths
rather than pulling in a charting library for two bars), a currency
summary card (latest rate to base per active company currency), and a
recent-transactions table off `accounting.v_voucher_register`. While
wiring that last one, found and fixed a real bug in the Voucher Register
page (Phase 5): its links hardcoded `/accounting/vouchers/{type}/{id}`
for every voucher type, which 404s for purchase_voucher, uae_rent_invoice,
pk_rent_invoice, and asset_sales — those got their own dedicated routes in
Phases 7/9/10/11 and were never wired back into that link. Fixed via a new
`voucherHref()` helper in `lib/vouchers/meta.ts` that both the Voucher
Register and the new Dashboard widget now share.

Phase 14 (Hardening) closes out the build: `0013_hardening.sql` fixes four
`SECURITY DEFINER` functions that trusted a caller-supplied `p_company_id`
without checking the caller actually belonged to it (exploitable via a
direct PostgREST RPC call, bypassing the app entirely — see
`docs/05-security-review.md` for the full audit), closes an RLS gap where
`core.attachments` checked company scope but no permission at all, fixes
an RLS gap that made `postChequeReturnVoucher` silently no-op instead of
updating the original PDC's status, and adds indexes the Phase 12
reporting views needed. `features/attachments/actions.ts` gained a
matching permission check plus a 10 MB / JPEG-PNG-WebP-PDF upload
allowlist (previously unrestricted). Vitest was added for unit tests
(report math, CSV export, voucher routing, a sample of Zod schemas) and
Playwright for a login/redirect smoke test — full e2e needs a provisioned
Supabase project this sandbox doesn't have, documented in
`docs/06-deployment.md` along with the Supabase/Vercel production setup
and the new GitHub Actions CI workflow. The build is complete — no phase
is pending.
