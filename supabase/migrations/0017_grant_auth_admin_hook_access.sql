-- =============================================================================
-- Fixes a second, more specific permission gap left over after
-- 0016_grant_schema_privileges.sql: the Custom Access Token Hook
-- (core.fn_custom_access_token_hook, wired up in Authentication → Hooks)
-- is invoked by Supabase Auth (GoTrue) directly against Postgres as the
-- `supabase_auth_admin` role — not `anon`/`authenticated`/`service_role`,
-- which 0016 covered. Without this, every password-grant login call
-- reached the hook, which queries core.user_profiles to look up
-- default_company_id, and failed with:
--   ERROR: permission denied for table user_profiles (SQLSTATE 42501)
-- causing GoTrue to return a 500 and the login to fail even with a
-- correct username/password.
-- =============================================================================

grant usage on schema core to supabase_auth_admin;
grant select on core.user_profiles to supabase_auth_admin;
