-- Alerts, and a receipt voucher that tells rather than asks.
--
-- A receipt was going through the approval workflow: money ARRIVING was held
-- up waiting for somebody to say yes, and a receipt nobody approved sat
-- pending while the bank statement said otherwise. That is the wrong shape for
-- a receipt. It posts on the spot now, and instead of blocking, it tells the
-- administrators it happened.
--
-- Which needs somewhere to tell them. Until now the only alert SSA could raise
-- was a push notification, and a push is lost if the browser was never given
-- permission, or the phone was off, or the person simply did not look. An
-- alert has to survive being missed, so it is a row.

create table if not exists core.alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  -- The person being told. One row per recipient: an alert read by one person
  -- is not read by the next, and a shared row could not say so.
  user_id uuid not null,
  -- What happened, as a key: 'receipt_voucher', 'payment_voucher'...
  kind text not null,
  title text not null,
  body text,
  -- Where it happened, so the alert is a way in and not only a notice.
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
comment on table core.alerts is
  'Things somebody should know about but need not act on. One row per recipient, so "read" is per person. Written server-side by the service role; a recipient can only read and mark their own.';

create index if not exists idx_alerts_inbox
  on core.alerts (user_id, company_id, created_at desc) where read_at is null;

alter table core.alerts enable row level security;

-- Only your own, and only in the company you are in. There is no insert policy
-- on purpose: alerts are raised server-side for OTHER people, which no
-- user-scoped policy can express, so the service role writes them.
drop policy if exists alerts_select on core.alerts;
create policy alerts_select on core.alerts for select
  using (user_id = auth.uid() and company_id = core.current_company_id());
drop policy if exists alerts_update on core.alerts;
create policy alerts_update on core.alerts for update
  using (user_id = auth.uid() and company_id = core.current_company_id())
  with check (user_id = auth.uid() and company_id = core.current_company_id());

grant select, update on core.alerts to authenticated;

-- ---------- who the administrators are -------------------------------------
-- core.is_admin() answers this for the CALLER, which is no use when the
-- question is "who should be told". Same rule as is_admin, by company: a
-- system role is an administrator.
create or replace function core.fn_admin_user_ids(p_company_id uuid)
 returns table(user_id uuid)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select distinct ur.user_id
    from core.user_roles ur
    join core.roles r on r.id = ur.role_id
   where ur.company_id = p_company_id
     and r.is_system_role;
$$;

comment on function core.fn_admin_user_ids is
  'The administrators of a company — users holding a system role. The audience for an alert that is nobody else''s business.';

revoke all on function core.fn_admin_user_ids(uuid) from public;
grant execute on function core.fn_admin_user_ids(uuid) to authenticated, service_role;

-- ---------- a receipt no longer waits for approval --------------------------
-- The workflow row stays, so Configuration still lists it and it can be turned
-- back on there. Turning it off here rather than hard-coding "receipts never
-- need approval" keeps the configuration honest: the screen says what happens.
update accounting.approval_workflows
   set is_active = false,
       updated_at = now()
 where voucher_type = 'receipt_voucher'
   and is_active;
