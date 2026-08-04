-- =============================================================================
-- Supabase's security advisor (lints 0028/0029) flags every SECURITY DEFINER
-- function that PostgREST exposes at /rest/v1/rpc/ and that the `anon` or
-- `authenticated` role can EXECUTE. Owned functions default to `EXECUTE` for
-- PUBLIC, and Supabase additionally grants `anon`/`authenticated` explicitly,
-- so by default anyone -- signed in or not -- can invoke them directly,
-- bypassing the app. This migration closes that surface for the functions that
-- have no business being called over the API at all, and drops `anon` from the
-- business RPCs that require a signed-in user.
--
-- Two groups:
--
--   A. Trigger and event-trigger functions. These fire from table triggers /
--      DDL events and run with the table owner's rights regardless of who (if
--      anyone) holds EXECUTE on them -- a direct `/rpc/` call only ever errors
--      (they return `trigger`, not a value). Nothing in the app calls them.
--      EXECUTE is revoked from PUBLIC, anon AND authenticated: fully internal.
--
--   B. Business RPCs the app invokes from server actions with an authenticated
--      session (see the `.rpc(...)` calls under features/ and lib/). Each
--      already re-checks the caller's company membership internally (Phase 14
--      hardening), but `anon` should never reach them in the first place, so
--      EXECUTE is revoked from PUBLIC and anon while `authenticated` keeps its
--      explicit grant. Lint 0029 (authenticated may execute a SECURITY DEFINER
--      RPC) is inherent to any callable business RPC and is left in place by
--      design.
--
-- Deliberately NOT touched, because they are needed exactly where they are:
--   * core.fn_username_to_email      -- called by `anon` during login, before a
--                                       session exists.
--   * core.current_company_id        -- referenced inside RLS policies; the
--   * core.user_has_permission          policy expression is evaluated as the
--                                       querying role, so anon/authenticated
--                                       must retain EXECUTE or policy checks
--                                       error out.
-- These three keep their existing grants intentionally.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Group A: trigger / event-trigger functions -- fully internal, no caller.
-- ---------------------------------------------------------------------------
revoke execute on function assets.fn_create_cost_center_for_asset()      from public, anon, authenticated;
revoke execute on function assets.fn_sync_cost_center_from_asset()       from public, anon, authenticated;
revoke execute on function assets.fn_sync_current_value_from_valuation() from public, anon, authenticated;
revoke execute on function core.fn_handle_new_auth_user()                from public, anon, authenticated;
revoke execute on function rental.fn_apply_pk_rent_payment()             from public, anon, authenticated;
revoke execute on function rental.fn_apply_uae_rent_payment()            from public, anon, authenticated;
revoke execute on function rental.fn_generate_pk_payment_schedule()      from public, anon, authenticated;
revoke execute on function rental.fn_generate_uae_payment_schedule()     from public, anon, authenticated;
revoke execute on function rental.fn_mark_pk_schedule_invoiced()         from public, anon, authenticated;
revoke execute on function rental.fn_mark_schedule_invoiced()            from public, anon, authenticated;
revoke execute on function rental.fn_validate_pk_advance_adjustment()    from public, anon, authenticated;

-- Event trigger: EXECUTE is irrelevant to firing; revoke to clear the lint.
revoke execute on function public.rls_auto_enable()                      from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Group B: business RPCs -- require a signed-in user; drop PUBLIC + anon,
-- keep the explicit `authenticated` (and `service_role`) grants intact.
-- ---------------------------------------------------------------------------
revoke execute on function accounting.fn_approval_action(uuid, text, text)      from public, anon;
revoke execute on function accounting.fn_start_approval(uuid, text, uuid, numeric) from public, anon;
revoke execute on function core.fn_bootstrap_company(text, text, text)          from public, anon;
revoke execute on function core.fn_exchange_rate_to_base(uuid, uuid, date)      from public, anon;
revoke execute on function core.fn_next_document_number(uuid, text)             from public, anon;
revoke execute on function core.fn_set_base_currency(uuid, uuid)                from public, anon;
