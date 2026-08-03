# Security Review (Phase 14)

Conducted at the end of the build, once every module existed to audit
together. Scope: RLS coverage across all 13 migrations, authorization
inside every `SECURITY DEFINER` function (these bypass RLS by design, so
each one is its own trust boundary), storage/attachment handling, and the
auth middleware. Findings are listed most severe first. Everything marked
**Fixed** was patched in `supabase/migrations/0013_hardening.sql` and/or
the application code in this same phase; everything marked **Accepted** is
a deliberate, documented trade-off.

## Addendum: live advisor pass (post-deployment)

Once a real Supabase project existed and the Supabase MCP connector was
attached, `get_advisors(type: "security")` was run directly against it —
the automated equivalent of this document's manual review. It confirmed
every finding below and surfaced one new one:

- **12 functions had no `search_path` pinned** (`function_search_path_mutable`):
  `core.fn_touch_updated_at`, `core.fn_custom_access_token_hook`,
  `core.fn_convert_to_base`, `core.fn_upsert_exchange_rate`, and 8 more in
  `accounting` — mostly trigger functions plus a couple of freestanding
  ones. An unpinned `search_path` leaves a function more susceptible to
  search-path-based object shadowing. Fixed in
  `supabase/migrations/0015_pin_function_search_paths.sql` (each function
  re-declared identically, just with `set search_path = public` added).
- The remaining 42 warnings (`anon`/`authenticated`-can-execute
  `SECURITY DEFINER` function, ×21 functions ×2 roles) are exactly the set
  already covered below: either intentionally public
  (`fn_username_to_email`, `current_company_id`, `user_has_permission`),
  trigger-only functions (`returns trigger`, not meaningfully callable
  outside trigger context despite being technically RPC-reachable), or the
  four already hardened with internal authorization checks. No further
  action taken on these — confirmed matches, not new findings.
- `public.rls_auto_enable()` is a Supabase-platform function, not part of
  this app's schema — out of scope.

## Fixed

### 1. Four `SECURITY DEFINER` functions trusted a caller-supplied `p_company_id`

`core.fn_set_base_currency`, `core.fn_exchange_rate_to_base`,
`core.fn_next_document_number`, and `accounting.fn_start_approval` all run
as `SECURITY DEFINER` (so they can write across tables the calling user
doesn't have direct RLS-granted access to — e.g. bumping another
company's-worth-of-irrelevant document sequence row) and all accept
`p_company_id` as a plain parameter, with no check that the caller actually
belongs to that company.

Every schema the app queries (`core`, `accounting`, `assets`, `rental`) is
necessarily an exposed API schema — the app's own `.schema("core").rpc(...)`
calls wouldn't work otherwise — which means these functions are callable
directly via `POST /rest/v1/rpc/<function>` by any authenticated user of
*any* company in the system, entirely bypassing the Next.js server actions
and their `requirePermission()` checks. Before this fix, a signed-up user of
Company A could call, e.g., `fn_next_document_number` with Company B's UUID
and consume/corrupt Company B's voucher numbering, or call
`fn_start_approval` to inject a fake approval record into another company's
pipeline.

**Fix:** each function now re-asserts the caller's authority before doing
anything:
- `fn_exchange_rate_to_base`, `fn_next_document_number`, `fn_start_approval`
  require `core.current_company_id() = p_company_id` (they're never called
  outside the caller's own active company) — `fn_next_document_number` and
  `fn_start_approval` additionally re-check the same permission
  (`post`/`edit`) the app layer already required before calling them, so a
  direct RPC call can't skip that either.
- `fn_set_base_currency` uses a `core.user_companies` membership check
  instead of strict equality, because it's also called mid-transaction from
  `fn_bootstrap_company` for a brand-new company, before the caller's JWT
  reflects it — `current_company_id()` would still resolve to the user's
  *previous* company at that point if they already had one active.

### 2. `core.attachments` RLS didn't check any permission, only `company_id`

`attachments_insert` and the soft-delete `attachments_delete` policy (an
`UPDATE` policy under a delete-shaped name, matching the rest of the app's
pattern) checked only `company_id = core.current_company_id()`. Since
`core.attachments` is polymorphic (`entity_type`/`entity_id`) and shared
across every module, this meant **any authenticated user of a company,
regardless of role or granted permissions**, could upload a file to any
entity or permanently delete any attachment in their company — including
title deeds and purchase agreements — with zero permission check.

**Fix:** both policies now also require
`core.user_has_permission(<module for entity_type>, 'edit')`, mapping
`entity_type` to the permission module that governs it (`asset` → `assets`,
`purchase_voucher` → itself). The same mapping was added at the application
layer (`features/attachments/actions.ts`) so the error surfaces as a clean
message rather than a raw RLS failure, and so `uploadAttachment`/
`deleteAttachment` fail before touching Storage at all.

While in that file: added a 10 MB upload size cap and a mime-type allowlist
(JPEG/PNG/WebP/PDF) — previously any file of any size or type could be
uploaded, turning the bucket into an unrestricted, unvalidated file host.

### 3. `postChequeReturnVoucher` silently failed to update the original PDC's status

`pdc_payment_vouchers_update`/`pdc_receipt_vouchers_update` only accepted
the PDC voucher's own `edit`/`post` permission. But
`postChequeReturnVoucher` (Phase 5) needs to flip the *original* PDC
voucher's `pdc_status` to `'returned'` after posting the return, and is
gated by `cheque_return_voucher:post` — a different permission a role could
easily hold without also holding `pdc_payment_voucher:edit`/`post`. RLS
would then silently match zero rows on that `UPDATE` (Postgres/PostgREST
report no error for an RLS-filtered update matching nothing), leaving the
cheque stuck at `pending` forever even though the return voucher posted
successfully and looked complete in the UI.

**Fix:** both PDC update policies now also accept
`cheque_return_voucher:post` as an alternative. As defense in depth,
`postChequeReturnVoucher` now also checks that the status update actually
returned a row and surfaces an explicit error if it didn't, instead of
treating a no-op as success.

## Accepted (reviewed, no change)

- **Overlapping `edit`/`delete` update policies** (e.g. `assets_update` +
  `assets_delete`, both `FOR UPDATE`): Postgres combines multiple permissive
  policies for the same command with `OR`, so a role holding only `delete`
  on a table can technically edit any column via the same `UPDATE`, not
  just `deleted_at`. This is a general RLS limitation (column-level
  separation needs a trigger, not a policy) already accepted at
  `journal_entries`/`journal_entry_lines` since Phase 5. Fixing it properly
  everywhere is a larger change than this phase's budget allows; noted here
  for awareness rather than silently ignored.
- **`fn_start_approval` doesn't verify `p_voucher_id` references a real,
  matching `journal_entries` row.** A legitimate user of their own company,
  with the right permission, could submit a bogus approval record for a
  voucher_id that doesn't exist. This is same-tenant data noise, not a
  cross-tenant boundary violation, and the app itself never does this — flagged
  as low-priority.
- **`core.fn_custom_access_token_hook`** has no `SECURITY DEFINER` and is
  invoked only by Supabase Auth's hook subsystem (not reachable via the
  PostgREST RPC endpoint), so it's outside the "direct RPC bypass" threat
  model this review focused on.
- **`accounting.fn_get_posting_account`, `core.fn_convert_to_base`,
  `core.fn_upsert_exchange_rate`** all run as `SECURITY INVOKER` (the
  default — no `SECURITY DEFINER` keyword), so RLS on the tables they touch
  still applies to the caller regardless of what `p_company_id` they pass.
  Confirmed safe as-is.
- **`npm audit`** reports 3 high-severity advisories, all transitive
  (`postcss`/`sharp` bundled inside `next`'s own `node_modules`). The
  suggested `npm audit fix --force` would downgrade `next` to `9.3.3` — a
  large breaking regression, not a real fix. Left alone; resolve by
  upgrading Next.js when it bundles patched versions upstream.

## Verified, no findings

- Every table across all 13 migrations has `ROW LEVEL SECURITY` enabled —
  confirmed by diffing every `create table` against every
  `alter table ... enable row level security`.
- No policy anywhere uses `using (true)` or `with check (true)` (the one
  instance of this, on `companies_insert`, was caught and removed back in
  Phase 1).
- `lib/auth/permissions.ts`'s `requirePermission()` throws on denial and is
  called before every mutating server action; the auth middleware
  (`lib/supabase/middleware.ts`) uses `supabase.auth.getUser()` (which
  round-trips to Supabase Auth to validate the JWT), not the insecure
  `getSession()` pattern that trusts an unverified cookie.
- No `dangerouslySetInnerHTML`, raw SQL string interpolation, or other
  injection-shaped code anywhere in the app — every query goes through the
  supabase-js query builder or a parameterized RPC call.
- Storage RLS (`storage_company_scoped_{select,insert,delete}`) correctly
  scopes every bucket by `(storage.foldername(name))[1] = company_id`.
