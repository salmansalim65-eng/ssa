-- An exchange rate entered later still serves an earlier date.
--
-- fn_exchange_rate_to_base only ever looked BACKWARDS: the newest rate on or
-- before the date, and an exception when there was none. Rates are entered as
-- the company starts using them, so the table's earliest AED row is dated
-- 10 Aug 2026 — while an opening balance is dated 1 Jan of the current year.
-- Every foreign-currency opening balance therefore failed with "No exchange
-- rate available for currency … on or before 2026-01-01", and no rate anyone
-- entered today could fix it: the row would have to be back-dated to January.
--
-- The lookup now falls forward when it has to: with nothing on or before the
-- date it takes the EARLIEST rate after it — the first rate the company ever
-- recorded for that currency, which is the best estimate available for a date
-- before any of them. A currency with no rate at all is still an error, because
-- that is a real gap rather than a question of dates.

create or replace function core.fn_exchange_rate_to_base(
  p_company_id uuid,
  p_currency_id uuid,
  p_as_of_date date default current_date
)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_is_base boolean;
  v_rate numeric(18,6);
begin
  if core.current_company_id() is distinct from p_company_id then
    raise exception 'Not authorized for company %', p_company_id;
  end if;

  select is_base_currency into v_is_base
  from core.company_currencies
  where company_id = p_company_id and currency_id = p_currency_id;

  if v_is_base then
    return 1;
  end if;

  -- The rate in force on the date: the most recent one on or before it.
  select rate_to_base into v_rate
  from core.exchange_rates
  where company_id = p_company_id
    and currency_id = p_currency_id
    and rate_date <= p_as_of_date
  order by rate_date desc
  limit 1;

  -- Nothing that early: fall forward to the first rate ever recorded for this
  -- currency rather than refusing the posting.
  if v_rate is null then
    select rate_to_base into v_rate
    from core.exchange_rates
    where company_id = p_company_id
      and currency_id = p_currency_id
    order by rate_date asc
    limit 1;
  end if;

  if v_rate is null then
    raise exception 'No exchange rate has been set for currency %', p_currency_id;
  end if;

  return v_rate;
end;
$function$;
