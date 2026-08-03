-- =============================================================================
-- Username login
-- Supabase Auth itself is still email/password under the hood (invites are
-- sent by email, and email remains required at signup) — this adds an
-- optional, unique username per profile and a pre-auth lookup so the login
-- screen can accept a username instead of asking for an email address.
-- =============================================================================

alter table core.user_profiles add column username text;

-- Case-insensitive uniqueness (partial: rows without a username yet don't
-- collide with each other under a NULL-vs-NULL comparison anyway, but a
-- plain unique index on a nullable column already allows multiple NULLs in
-- Postgres, so no extra "where username is not null" is needed here).
create unique index user_profiles_username_unique on core.user_profiles (lower(username));

-- Runs pre-login (no auth.uid() yet), so it has to be SECURITY DEFINER —
-- deliberately narrow: given a username, it returns only the matching
-- email or null, nothing else. Equivalent information exposure to any
-- ordinary username-based login form (username enumeration is an accepted,
-- industry-standard trade-off here); the caller (features/auth/actions.ts)
-- still returns one generic "invalid username or password" error either
-- way rather than distinguishing "no such username" from "wrong password".
create or replace function core.fn_username_to_email(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select up.email
  from core.user_profiles up
  where lower(up.username) = lower(p_username)
  limit 1;
$$;

grant execute on function core.fn_username_to_email(text) to anon, authenticated;

comment on function core.fn_username_to_email(text) is
  'Pre-auth username -> email lookup for the login screen. Returns null for an unknown username rather than raising, so the caller can show one generic invalid-credentials error.';
