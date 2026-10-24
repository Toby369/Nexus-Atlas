-- Exportiert aus supabase_migrations.schema_migrations (20260826130254 create_get_funding_intelligence)

create or replace function public.get_funding_intelligence(p_lookback_hours integer default 24)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with latest_per_exchange as (
    select distinct on (exchange) exchange, funding_rate, timestamp_utc
    from market_snapshots
    where status = 'ok' and funding_rate is not null
      and timestamp_utc >= now() - interval '30 minutes'
    order by exchange, timestamp_utc desc
  ),
  reference_per_exchange as (
    -- Je Boerse der juengste Funding-Rate-Wert VOR dem Lookback-Fenster
    -- (asof, gleiches Prinzip wie get_market_reference_snapshot), damit
    -- das Delta pro Boerse konsistent ueber denselben Zeitraum berechnet
    -- wird statt einen einzelnen globalen Zeitpunkt zu erzwingen.
    select distinct on (m.exchange) m.exchange, m.funding_rate
    from market_snapshots m
    where m.status = 'ok' and m.funding_rate is not null
      and m.timestamp_utc <= now() - (p_lookback_hours || ' hours')::interval
    order by m.exchange, m.timestamp_utc desc
  ),
  per_exchange as (
    select
      l.exchange,
      l.funding_rate as current_rate,
      r.funding_rate as reference_rate,
      l.funding_rate - r.funding_rate as delta
    from latest_per_exchange l
    left join reference_per_exchange r on r.exchange = l.exchange
  ),
  agg as (
    select
      avg(current_rate) as avg_current_rate,
      avg(delta) filter (where delta is not null) as avg_delta,
      max(current_rate) - min(current_rate) as cross_exchange_spread,
      count(*) as exchange_count
    from per_exchange
  )
  select jsonb_build_object(
    'avg_current_rate', (select avg_current_rate from agg),
    'avg_delta', (select avg_delta from agg),
    'cross_exchange_spread', (select cross_exchange_spread from agg),
    'exchange_count', (select exchange_count from agg),
    'per_exchange', coalesce((select jsonb_agg(row_to_json(per_exchange)) from per_exchange), '[]'::jsonb)
  );
$$;

comment on function public.get_funding_intelligence is 'Phase 1-Nachtrag: Funding-Erweiterung (Delta, Cross-Exchange-Divergenz) -- avg_current_rate/avg_delta sind ueber alle Boersen mit frischem (<=30 Min) Funding-Wert gemittelt. avg_delta = Veraenderung ggue. dem asof-Referenzwert vor p_lookback_hours (Default 24h) je Boerse, dann gemittelt. cross_exchange_spread = max-min der aktuellen Raten -- ein grosser Spread deutet auf abweichende Positionierung/Sentiment zwischen Boersen hin. Extremwert-Einordnung (deutlich/leicht positiv/negativ) nutzt dieselben Schwellen wie describeFunding() in collect-btc (0.0001/0.0005), angewendet auf avg_current_rate durch den Aufrufer.';
