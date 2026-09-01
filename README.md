# SSA ERP

Enterprise-grade, multi-company, multi-currency ERP for managing rental real
estate assets (Pakistan & UAE) and full double-entry accounting.

## Stack

| Layer          | Choice                                              |
|----------------|------------------------------------------------------|
| Frontend       | Next.js (App Router) + React + TypeScript             |
| Styling/UI     | Tailwind CSS + shadcn/ui                              |
| Forms          | React Hook Form + Zod                                 |
| Backend/DB     | Supabase (PostgreSQL, Auth, Storage, RLS)              |
| Hosting        | Vercel                                                |
| VCS            | GitHub                                               |

## Documentation

This project is built **module by module**, not all at once. Before any
module's code is written, its schema, RLS policies, services, and UI are
designed, reviewed, and only then implemented. Start here:

1. [`docs/01-architecture.md`](docs/01-architecture.md) — system architecture,
   multi-tenancy, auth/RBAC model, currency engine, approval engine, audit
   trail, storage strategy.
2. [`docs/02-database-schema.md`](docs/02-database-schema.md) — complete
   conceptual data model (all schemas/tables/relationships) used as the
   blueprint for every module's migrations.
3. [`docs/03-folder-structure.md`](docs/03-folder-structure.md) — repository
   and application folder layout.
4. [`docs/04-roadmap.md`](docs/04-roadmap.md) — phased, module-by-module
   development roadmap with the status tracker below.
5. [`docs/05-security-review.md`](docs/05-security-review.md) — Phase 14's
   RLS/authorization audit: findings, fixes, and accepted trade-offs.
6. [`docs/06-deployment.md`](docs/06-deployment.md) — Supabase + Vercel
   production setup, environment variables, and the CI pipeline.

## Module Status

| # | Phase | Status |
|---|-------|--------|
| 0 | Architecture, schema design, folder structure, roadmap (this doc set) | ✅ Done |
| 1 | Foundation: companies, auth, users, roles/permissions, audit trail, storage, sequences | ✅ Done |
| 2 | Currency Master & Daily Exchange Rates | ✅ Done |
| 3 | Chart of Accounts & Cost Centers | ✅ Done |
| 4 | Accounting Engine Core (journal engine, voucher framework, approval workflow) | ✅ Done |
| 5 | Core Accounting Vouchers (Receipt, Payment, JV, JV Maintenance, Opening Balance, PDC, Cheque Return) | ✅ Done |
| 6 | Asset Registration | ✅ Done |
| 7 | Purchase Property | ✅ Done |
| 8 | Asset Current Value | ✅ Done |
| 9 | UAE Rental Management | ✅ Done |
| 10 | Pakistan Rental Management | ✅ Done |
| 11 | Asset Sale | ✅ Done |
| 12 | Reports Engine | ✅ Done |
| 13 | Dashboard | ✅ Done |
| 14 | Hardening: testing, security review, performance, deployment | ✅ Done |

Each phase is only started after the previous one is reviewed and approved.

## Getting started (Phase 1)

1. Create a Supabase project, then apply `supabase/migrations/0001_foundation.sql`
   (via `supabase db push` or the SQL editor).
2. In the Supabase dashboard, enable the Custom Access Token Hook under
   Authentication → Hooks, pointing at `core.fn_custom_access_token_hook`
   (already wired for local dev in `supabase/config.toml`).
3. Copy `.env.example` to `.env.local` and fill in your project's URL, anon
   key, and service role key.
4. `npm install && npm run dev`, then sign up a user, sign in, and create
   your first company from the onboarding screen — you'll be its
   Administrator with every permission granted.

For a production rollout, see [`docs/06-deployment.md`](docs/06-deployment.md).

## Testing

- `npm test` — unit tests (Vitest) for pure business logic: report
  aggregation/running-balance math, CSV export, voucher routing, and a
  sample of Zod schema validation.
- `npm run test:e2e` — Playwright smoke test covering the unauthenticated
  redirect and the login page (the only things testable without a
  provisioned Supabase project — see `docs/06-deployment.md` for extending
  this against a real backend).
- `npx tsc --noEmit` / `npm run lint` — type check / lint, both run in CI.
