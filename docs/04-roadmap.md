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

**Status:** Phases 1–9 are implemented — see
`supabase/migrations/0001_foundation.sql` through `0009_uae_rental.sql`,
and the Next.js app under `app/`, `features/`, `lib/`, `components/`. Phase 9
adds tenants, UAE leases with auto-generated monthly/yearly payment
schedules, on-demand rent invoice generation (Dr Tenant Receivable / Cr UAE
Rental Income via the Phase 4 posting engine), and rent payment collection
against outstanding invoice balances (posted immediately, bypassing the
draft→approval pipeline since it's an ancillary collection action rather
than a primary voucher type). Next up: Phase 10 (Pakistan Rental
Management), pending review.
