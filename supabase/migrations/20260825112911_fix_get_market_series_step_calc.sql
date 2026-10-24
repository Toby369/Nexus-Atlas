-- Exportiert aus supabase_migrations.schema_migrations (20260825112911 fix_get_market_series_step_calc)

-- Bugfix: greatest(1, total / p_max_points) nutzte Integer-Division, die
-- abrundet. Bei total=735, p_max_points=500 ergab das step=1 (735/500=1 in
-- Integer-Arithmetik) statt der noetigen 2 -- keine Downsampling-Wirkung im
-- Bereich (max_points, 2*max_points). Ceiling-Division behebt das.
create or replace function public.get_market_series(
  p_exchange text,
  p_since timestamptz,
  p_max_points int default 500
)
returns table (
  timestamp_utc timestamptz,
  last_price numeric,
  open_interest numeric
)
language sql
stable
as $$
  with base as (
    select m.timestamp_utc, m.last_price, m.open_interest,
           row_number() over (order by m.timestamp_utc asc) as rn,
           count(*) over () as total
    from market_snapshots m
    where m.exchange = p_exchange
      and m.status = 'ok'
      and m.timestamp_utc >= p_since
  )
  select base.timestamp_utc, base.last_price, base.open_interest
  from base
  where total <= p_max_points
     or rn = 1
     or rn = total
     or rn % greatest(1, ceil(total::numeric / p_max_points)::int) = 0
  order by base.timestamp_utc asc;
$$;

grant execute on function public.get_market_series(text, timestamptz, int) to anon, authenticated;
