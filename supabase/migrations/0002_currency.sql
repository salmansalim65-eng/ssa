-- =============================================================================
-- Phase 2: Currency Master & Daily Exchange Rates
-- core.currencies is a shared, cross-company catalog (ISO codes are
-- universal); core.company_currencies lets each company pick which
-- currencies it transacts in and which one is its base currency;
-- core.exchange_rates holds daily/historical rate-to-base per company,
-- since two companies can have different base currencies.
-- =============================================================================

create table core.currencies (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  name             text not null,
  symbol           text not null,
  decimal_places   smallint not null default 2 check (decimal_places between 0 and 6),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  constraint currencies_code_unique unique (code)
);

create trigger trg_currencies_touch
  before update on core.currencies
  for each row execute function core.fn_touch_updated_at();

insert into core.currencies (code, name, symbol, decimal_places) values
  ('PKR', 'Pakistani Rupee', 'Rs', 2),
  ('AED', 'UAE Dirham', 'د.إ', 2),
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'British Pound', '£', 2),
  ('SAR', 'Saudi Riyal', 'SR', 2)
on conflict (code) do nothing;

create table core.company_currencies (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  currency_id      uuid not null references core.currencies(id) on delete restrict,
  is_base_currency boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  constraint company_currencies_unique unique (company_id, currency_id)
);

create unique index idx_company_currencies_one_base
  on core.company_currencies (company_id)
  where is_base_currency;

create index idx_company_currencies_company on core.company_currencies(company_id);

create trigger trg_company_currencies_touch
  before update on core.company_currencies
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_company_currencies after insert or update or delete on core.company_currencies
  for each row execute function audit.fn_row_audit();

create table core.exchange_rates (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  currency_id      uuid not null references core.currencies(id) on delete restrict,
  rate_date        date not null,
  rate_to_base     numeric(18,6) not null check (rate_to_base > 0),
  source           text not null default 'manual' check (source in ('manual','api')),
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  constraint exchange_rates_unique unique (company_id, currency_id, rate_date)
);

create index idx_exchange_rates_lookup on core.exchange_rates(company_id, currency_id, rate_date desc);

create trigger trg_exchange_rates_touch
  before update on core.exchange_rates
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_exchange_rates after insert or update or delete on core.exchange_rates
  for each row execute function audit.fn_row_audit();

-- -----------------------------------------------------------------------------
-- Bootstrap: seed the company_currencies row for a bootstrapped company's
-- home currency (PKR for Pakistan, AED for UAE) as its base currency.
-- -----------------------------------------------------------------------------

create or replace function core.fn_set_base_currency(p_company_id uuid, p_currency_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update core.company_currencies
  set is_base_currency = false, updated_by = auth.uid(), updated_at = now()
  where company_id = p_company_id and is_base_currency;

  insert into core.company_currencies (company_id, currency_id, is_base_currency, is_active)
  values (p_company_id, p_currency_id, true, true)
  on conflict (company_id, currency_id)
    do update set is_base_currency = true, is_active = true, updated_by = auth.uid(), updated_at = now();
end;
$$;

comment on function core.fn_set_base_currency(uuid, uuid) is
  'Atomically swaps a company''s base currency: unsets any existing base currency row, then sets (or creates) the requested one. The partial unique index on company_currencies(company_id) where is_base_currency guarantees at most one base currency per company even under concurrent calls.';

create or replace function core.fn_bootstrap_company(
  p_company_name text,
  p_company_code text,
  p_country text
)
returns core.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company core.companies;
  v_role_id uuid;
  v_role_name text;
  v_base_currency_code text;
  v_base_currency_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to bootstrap a company';
  end if;

  insert into core.companies (code, name, country, created_by)
  values (p_company_code, p_company_name, p_country, auth.uid())
  returning * into v_company;

  foreach v_role_name in array array['Administrator','Accountant','Property Manager','Supervisor','Finance Manager']
  loop
    insert into core.roles (company_id, name, is_system_role, created_by)
    values (v_company.id, v_role_name, v_role_name = 'Administrator', auth.uid())
    returning id into v_role_id;

    if v_role_name = 'Administrator' then
      insert into core.role_permissions (role_id, permission_id, allowed)
      select v_role_id, id, true from core.permissions;
    end if;
  end loop;

  insert into core.user_companies (user_id, company_id, is_default)
  values (auth.uid(), v_company.id, true);

  update core.user_profiles set default_company_id = v_company.id where id = auth.uid();

  insert into core.user_roles (user_id, role_id, company_id)
  select auth.uid(), id, v_company.id from core.roles
  where company_id = v_company.id and name = 'Administrator';

  v_base_currency_code := case p_country when 'AE' then 'AED' else 'PKR' end;
  select id into v_base_currency_id from core.currencies where code = v_base_currency_code;
  if v_base_currency_id is not null then
    perform core.fn_set_base_currency(v_company.id, v_base_currency_id);
  end if;

  return v_company;
end;
$$;

comment on function core.fn_bootstrap_company(text, text, text) is
  'Creates a new company, seeds its default roles, grants the calling user the Administrator role, makes it their default company, and sets its base currency (PKR for Pakistan, AED for UAE). This is the only sanctioned way to insert into core.companies.';

-- -----------------------------------------------------------------------------
-- Exchange rate lookup / conversion helpers
-- -----------------------------------------------------------------------------

create or replace function core.fn_exchange_rate_to_base(
  p_company_id uuid,
  p_currency_id uuid,
  p_as_of_date date default current_date
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_base boolean;
  v_rate numeric(18,6);
begin
  select is_base_currency into v_is_base
  from core.company_currencies
  where company_id = p_company_id and currency_id = p_currency_id;

  if v_is_base then
    return 1;
  end if;

  select rate_to_base into v_rate
  from core.exchange_rates
  where company_id = p_company_id
    and currency_id = p_currency_id
    and rate_date <= p_as_of_date
  order by rate_date desc
  limit 1;

  if v_rate is null then
    raise exception 'No exchange rate available for currency % on or before %', p_currency_id, p_as_of_date;
  end if;

  return v_rate;
end;
$$;

comment on function core.fn_exchange_rate_to_base(uuid, uuid, date) is
  'Returns the rate that converts one unit of p_currency_id into the company''s base currency, as of the most recent rate on or before p_as_of_date. Returns 1 if p_currency_id is already the base currency. Raises if no rate has ever been entered for that currency on or before the date.';

create or replace function core.fn_convert_to_base(
  p_company_id uuid,
  p_currency_id uuid,
  p_amount numeric,
  p_as_of_date date default current_date
)
returns numeric
language sql
stable
as $$
  select p_amount * core.fn_exchange_rate_to_base(p_company_id, p_currency_id, p_as_of_date);
$$;

comment on function core.fn_convert_to_base(uuid, uuid, numeric, date) is
  'Converts p_amount in p_currency_id to the company''s base currency as of p_as_of_date. The accounting engine (Phase 4+) freezes the resulting base amount at posting time rather than recalculating it later.';

create or replace function core.fn_upsert_exchange_rate(
  p_company_id uuid,
  p_currency_id uuid,
  p_rate_date date,
  p_rate_to_base numeric
)
returns core.exchange_rates
language plpgsql
security invoker
as $$
declare
  v_row core.exchange_rates;
begin
  insert into core.exchange_rates (company_id, currency_id, rate_date, rate_to_base, created_by)
  values (p_company_id, p_currency_id, p_rate_date, p_rate_to_base, auth.uid())
  on conflict (company_id, currency_id, rate_date)
    do update set rate_to_base = excluded.rate_to_base, updated_by = auth.uid(), updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function core.fn_upsert_exchange_rate(uuid, uuid, date, numeric) is
  'Inserts today''s (or a backdated) rate, or corrects an existing one for the same day, without ever overwriting created_by. security invoker: RLS on core.exchange_rates still applies to the caller.';

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table core.currencies enable row level security;
alter table core.company_currencies enable row level security;
alter table core.exchange_rates enable row level security;

create policy currencies_select on core.currencies
  for select using (auth.uid() is not null);
create policy currencies_insert on core.currencies
  for insert with check (core.user_has_permission('currencies', 'create'));
create policy currencies_update on core.currencies
  for update using (core.user_has_permission('currencies', 'edit'));

create policy company_currencies_select on core.company_currencies
  for select using (company_id = core.current_company_id());
create policy company_currencies_write on core.company_currencies
  for all using (
    company_id = core.current_company_id() and core.user_has_permission('currencies', 'edit')
  ) with check (
    company_id = core.current_company_id() and core.user_has_permission('currencies', 'edit')
  );

create policy exchange_rates_select on core.exchange_rates
  for select using (company_id = core.current_company_id());
create policy exchange_rates_write on core.exchange_rates
  for all using (
    company_id = core.current_company_id() and core.user_has_permission('exchange_rates', 'edit')
  ) with check (
    company_id = core.current_company_id() and core.user_has_permission('exchange_rates', 'edit')
  );
