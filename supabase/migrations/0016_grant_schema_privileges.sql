-- =============================================================================
-- Critical fix: none of the 15 prior migrations ever granted baseline
-- schema USAGE or table-level privileges to the anon/authenticated
-- Postgres roles that PostgREST uses. RLS policies were correctly in
-- place on every table from Phase 1 onward, but RLS is a secondary
-- row-level filter — Postgres requires the underlying GRANT before RLS is
-- even evaluated. Without this, every custom schema (core, accounting,
-- assets, rental, reporting, audit) was completely inaccessible to the
-- app, for every user, not just the new username-login lookup that
-- surfaced it.
--
-- This mirrors what Supabase's dashboard does automatically for any
-- schema added to the project's "Exposed schemas" API setting, and for
-- the `public` schema by default on every new project.
-- =============================================================================

grant usage on schema core, accounting, assets, rental, reporting, audit
  to anon, authenticated, service_role;

grant all on all tables in schema core, accounting, assets, rental, audit
  to anon, authenticated, service_role;
grant select on all tables in schema reporting to anon, authenticated, service_role;

grant all on all sequences in schema core, accounting, assets, rental, audit
  to anon, authenticated, service_role;

grant all on all routines in schema core, accounting, assets, rental, reporting, audit
  to anon, authenticated, service_role;

-- So future tables/functions/sequences created via later migrations get
-- the same grants automatically, without needing to remember this step
-- again for every new object.
alter default privileges in schema core grant all on tables to anon, authenticated, service_role;
alter default privileges in schema accounting grant all on tables to anon, authenticated, service_role;
alter default privileges in schema assets grant all on tables to anon, authenticated, service_role;
alter default privileges in schema rental grant all on tables to anon, authenticated, service_role;
alter default privileges in schema audit grant all on tables to anon, authenticated, service_role;
alter default privileges in schema reporting grant select on tables to anon, authenticated, service_role;

alter default privileges in schema core grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema accounting grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema assets grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema rental grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema audit grant all on sequences to anon, authenticated, service_role;

alter default privileges in schema core grant all on routines to anon, authenticated, service_role;
alter default privileges in schema accounting grant all on routines to anon, authenticated, service_role;
alter default privileges in schema assets grant all on routines to anon, authenticated, service_role;
alter default privileges in schema rental grant all on routines to anon, authenticated, service_role;
alter default privileges in schema reporting grant all on routines to anon, authenticated, service_role;
alter default privileges in schema audit grant all on routines to anon, authenticated, service_role;
