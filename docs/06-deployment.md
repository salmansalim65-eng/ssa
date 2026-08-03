# Deployment (Phase 14)

## 1. Supabase project setup

1. Create a new Supabase project (production tier, not the free sandbox,
   once real tenants are onboarding).
2. Apply every migration in order:
   ```
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   This applies `supabase/migrations/0001_foundation.sql` through
   `0015_pin_function_search_paths.sql` in filename order. There is no seed data — the
   first signed-up user creates their own company via the onboarding
   screen (`core.fn_bootstrap_company`).
3. **Custom Access Token Hook** (required — without it, `company_id` never
   lands in the JWT and every RLS policy falls back to the user's
   `default_company_id`, which breaks multi-company switching):
   Authentication → Hooks → Custom Access Token → point at
   `core.fn_custom_access_token_hook`.
4. **Storage buckets** — create these five, all **private** (RLS-only
   access, no public bucket policy): `asset-images`, `title-deeds`,
   `agreements`, `receipts`, `attachments`. The RLS policies in
   `0001_foundation.sql` (`storage_company_scoped_*`) already scope every
   object by `(storage.foldername(name))[1] = company_id`, so no per-bucket
   policy configuration is needed beyond creating them and marking them
   private.
5. **API settings** → confirm `core`, `accounting`, `assets`, `rental`, and
   `reporting` are all in the exposed schema list (the app's
   `.schema("...")` calls depend on this; `audit` is intentionally **not**
   exposed — nothing queries it directly, only the generic trigger writes
   to it).
6. Copy the project's URL, anon key, and service role key for step 3 below.
7. **First user, and the username/email split:** the app's login screen
   only asks for a **username**, but Supabase Auth itself is still
   email/password underneath — `core.fn_username_to_email` resolves a
   username to its account's email pre-login (see
   `0014_username_login.sql`). There's no self-serve signup screen, so
   create the first user directly:
   - **Authentication → Users → Add user** — a real email, a password,
     "Auto Confirm User" checked.
   - That user has no username yet, so the login screen can't resolve them
     to an account. In the SQL Editor, run:
     ```sql
     update core.user_profiles set username = 'admin' where email = '<that email>';
     ```
   - Log in at `/login` with `admin` / the password you set. You'll land on
     onboarding to create the first company, which makes you its
     Administrator automatically.
   - Every user after that should go through **Admin → Users → Invite
     user**, which has a username field built in — no manual SQL needed.

## 2. Vercel project setup

1. Import the GitHub repository into Vercel.
2. Environment variables (Project Settings → Environment Variables), for
   Production **and** Preview:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only; never referenced from a
     `NEXT_PUBLIC_*` variable or shipped to the client. Used only inside
     Server Actions / Route Handlers via `lib/supabase/server.ts`.
3. Build command / output: defaults (`next build`, `.next`) — no
   `vercel.json` overrides needed, this is a standard App Router project.
4. Framework preset: Next.js (auto-detected).

Preview deployments (one per PR) will talk to the **same** Supabase
project as production unless you provision a separate staging project —
for a real rollout, provision a second Supabase project for Preview and
point its env vars there instead, so preview branches can't touch
production tenant data.

## 3. Continuous Integration

`.github/workflows/ci.yml` runs on every push and pull request:
`npm ci` → `tsc --noEmit` → `eslint --max-warnings=0` → `vitest run` →
`next build` (with placeholder Supabase env vars — the build never makes a
real network call, so this catches type/build regressions without needing
project secrets in CI).

`e2e` (Playwright) is **not** wired into this workflow — the smoke test in
`tests/e2e/smoke.spec.ts` only covers the unauthenticated redirect and the
login form, since this repo has no CI-provisioned Supabase project to test
against. To extend it: provision a dedicated Supabase project for CI (or a
local `supabase start` instance, since the Supabase CLI ships a full local
Postgres + Auth + Storage stack via Docker), run migrations against it,
seed a test company/user, then add `NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` as repo secrets
and point Playwright's `webServer` at that project instead of the
placeholder one.

## 4. Migration pipeline for future phases

Every future schema change ships as a new
`supabase/migrations/NNNN_description.sql` file (never edit a shipped
migration — this project's entire history follows that rule). Applying to
production:
```
supabase link --project-ref <prod-project-ref>
supabase db push
```
Run this as a manual, deliberate step after a PR merges — not
automatically in CI — since a migration can be destructive and Supabase
has no automatic rollback. Review the migration's diff against
`supabase db diff` output before pushing to production.

## 5. Post-deploy checklist

- [ ] Sign up the first user, create the first company via onboarding,
      confirm they land on `/dashboard` as Administrator.
- [ ] Configure at least one Cash and one Bank account in Chart of
      Accounts (flip `is_cash`/`is_bank`) so the Cash Book / Bank Book
      reports have something to show.
- [ ] Configure Posting Templates for `purchase_voucher`, `uae_rent_invoice`,
      `pk_rent_invoice`, and `asset_sales` before using those screens —
      each blocks with a clear error until its accounts are set.
- [ ] Set each active currency's base/exchange rate under Admin → Currencies
      before posting any non-base-currency voucher (posting fails loudly,
      not silently, if a rate is missing for the entry date).
