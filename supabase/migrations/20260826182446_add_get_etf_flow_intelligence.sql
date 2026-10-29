-- Exportiert aus supabase_migrations.schema_migrations (20260826182446 add_get_etf_flow_intelligence)

-- Spec-Vorgabe: ETF-Flows ueber die bestehende Netto-Flow-Anzeige hinaus um
-- Momentum, Preis-/OI-Vergleich und Trend erweitern -- ausschliesslich aus
-- bereits vorhandenen Daten (etf_flows, candles, aggregiertes OI ueber die
-- bereits fixierte get_market_series-RPC, keine doppelte OI-Logik).
--
-- Teilt die letzten p_days verfuegbaren Handelstage in zwei Haelften
-- (juengere/aeltere) und vergleicht deren Flow-Summen (Momentum), sowie
-- Preis- und OI-Veraenderung ueber denselben Zeitraum. Liefert null statt
-- eines erfundenen Werts, wenn nicht genug Historie/Daten vorhanden sind
-- (z.B. price_change_pct/oi_change_pct null, wenn kein Referenzpunkt
-- gefunden wird) -- entspricht der "nicht verfuegbar statt Dummy-Wert"
-- Vorgabe.
create or replace function public.get_etf_flow_intelligence(p_days integer default 10)
returns jsonb
language sql
stable
as $$
with daily as (
  select distinct on (flow_date) flow_date, total_flow_usd_m
  from etf_flows
  order by flow_date desc, (source = 'sosovalue') desc
),
windowed as (
  select flow_date, total_flow_usd_m,
    row_number() over (order by flow_date desc) as rn
  from daily
  order by flow_date desc
  limit p_days
),
halves as (
  select
    sum(total_flow_usd_m) filter (where rn <= ceil(p_days::numeric / 2)) as recent_sum,
    count(*) filter (where rn <= ceil(p_days::numeric / 2)) as recent_days,
    sum(total_flow_usd_m) filter (where rn > ceil(p_days::numeric / 2)) as prior_sum,
    count(*) filter (where rn > ceil(p_days::numeric / 2)) as prior_days,
    min(flow_date) as earliest_date,
    max(flow_date) as latest_date,
    count(*) as window_days_used
  from windowed
),
price_bounds as (
  select
    (select close from candles
      where interval = '1d' and symbol = 'BTCUSDT' and exchange = 'binance'
        and open_time <= (select earliest_date from halves)::timestamptz
      order by open_time desc limit 1) as price_start,
    (select close from candles
      where interval = '1d' and symbol = 'BTCUSDT' and exchange = 'binance'
        and open_time <= (select latest_date from halves)::timestamptz
      order by open_time desc limit 1) as price_end
),
oi_series as (
  select timestamp_utc, open_interest
  from get_market_series('aggregated', ((select earliest_date from halves)::timestamptz - interval '1 day'), 20000)
),
oi_bounds as (
  select
    (select open_interest from oi_series
      where timestamp_utc <= (select earliest_date from halves)::timestamptz + interval '1 day'
      order by timestamp_utc desc limit 1) as oi_start,
    (select open_interest from oi_series
      where timestamp_utc <= (select latest_date from halves)::timestamptz + interval '1 day'
      order by timestamp_utc desc limit 1) as oi_end
)
select jsonb_build_object(
  'window_days_used', h.window_days_used,
  'recent_sum_usd_m', h.recent_sum,
  'recent_days', h.recent_days,
  'prior_sum_usd_m', h.prior_sum,
  'prior_days', h.prior_days,
  'momentum_usd_m',
    case when h.recent_sum is not null and h.prior_sum is not null
         then h.recent_sum - h.prior_sum else null end,
  'momentum_pct',
    case when h.recent_sum is not null and h.prior_sum is not null and h.prior_sum <> 0
         then round(((h.recent_sum - h.prior_sum) / abs(h.prior_sum)) * 100, 1)
         else null end,
  'earliest_date', h.earliest_date,
  'latest_date', h.latest_date,
  'price_start', pb.price_start,
  'price_end', pb.price_end,
  'price_change_pct',
    case when pb.price_start is not null and pb.price_end is not null and pb.price_start <> 0
         then round(((pb.price_end - pb.price_start) / pb.price_start) * 100, 2)
         else null end,
  'oi_start', ob.oi_start,
  'oi_end', ob.oi_end,
  'oi_change_pct',
    case when ob.oi_start is not null and ob.oi_end is not null and ob.oi_start <> 0
         then round(((ob.oi_end - ob.oi_start) / ob.oi_start) * 100, 2)
         else null end
)
from halves h, price_bounds pb, oi_bounds ob;
$$;

comment on function public.get_etf_flow_intelligence(integer) is 'ETF-Flow-Momentum (juengere vs. aeltere Haelfte des Fensters) sowie Preis-/OI-Veraenderung ueber denselben Zeitraum -- reine Analyse-Layer-Funktion, keine Kachel-eigene Logik. Nutzt get_market_series(aggregated) fuer OI, keine zweite OI-Berechnung.';
