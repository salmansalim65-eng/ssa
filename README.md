# Rental & Accounting Multi-Currency ERP

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

## Module Status

| # | Phase | Status |
|---|-------|--------|
| 0 | Architecture, schema design, folder structure, roadmap (this doc set) | ✅ Done |
| 1 | Foundation: companies, auth, users, roles/permissions, audit trail, storage, sequences | ✅ Done |
| 2 | Currency Master & Daily Exchange Rates | ⬜ Not started |
| 3 | Chart of Accounts & Cost Centers | ⬜ Not started |
| 4 | Accounting Engine Core (journal engine, voucher framework, approval workflow) | ⬜ Not started |
| 5 | Core Accounting Vouchers (Receipt, Payment, JV, JV Maintenance, Opening Balance, PDC, Cheque Return) | ⬜ Not started |
| 6 | Asset Registration | ⬜ Not started |
| 7 | Purchase Property | ⬜ Not started |
| 8 | Asset Current Value | ⬜ Not started |
| 9 | UAE Rental Management | ⬜ Not started |
| 10 | Pakistan Rental Management | ⬜ Not started |
| 11 | Asset Sale | ⬜ Not started |
| 12 | Reports Engine | ⬜ Not started |
| 13 | Dashboard | ⬜ Not started |
| 14 | Hardening: testing, security review, performance, deployment | ⬜ Not started |

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
