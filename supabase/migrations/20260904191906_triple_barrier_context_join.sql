-- Exportiert aus supabase_migrations.schema_migrations (20260904191906 triple_barrier_context_join)


-- Verknuepft jede Triple-Barrier-Entry mit dem Markt-Kontext GENAU zum
-- Signal-Zeitpunkt (letzte ABGESCHLOSSENE Kerze je Intervall vor/bei
-- signal_time -- kein Lookahead). mtf_aligned = Toby's eigene Methodik:
-- 1h/4h/1d-Struktur stimmen alle mit der Trade-Richtung ueberein.
create table if not exists public.research_triple_barrier_context (
  interval text not null,
  direction text not null,
  tp_pct numeric not null,
  sl_pct numeric not null,
  vertical_bars integer not null,
  signal_time timestamptz not null,
  outcome text not null,
  rsi_14_15m numeric,
  structure_trend_15m text,
  cvd_trend_15m text,
  adx_14_15m numeric,
  trend_dir_15m text,
  structure_trend_1h text,
  structure_trend_4h text,
  structure_trend_1d text,
  mtf_aligned boolean,
  has_pattern_matching_direction boolean,
  primary key (interval, direction, tp_pct, sl_pct, vertical_bars, signal_time)
);
alter table public.research_triple_barrier_context enable row level security;
create policy research_triple_barrier_context_select_all on public.research_triple_barrier_context for select to public using (true);

create or replace function public.research_build_triple_barrier_context(
  p_signal_start timestamptz,
  p_signal_end timestamptz
)
returns integer
language sql
as $$
  with src as (
    select * from public.research_triple_barrier_results
    where interval = '15m' and tp_pct = 1.5 and sl_pct = 0.5 and vertical_bars = 192
      and signal_time >= p_signal_start and signal_time < p_signal_end
  ),
  mf15 as (
    select s.*, mf.rsi_14, mf.structure_trend, mf.cvd_trend, mf.adx_14, mf.plus_di, mf.minus_di
    from src s
    left join lateral (
      select rsi_14, structure_trend, cvd_trend, adx_14, plus_di, minus_di
      from market_features
      where symbol = 'BTCUSDT' and interval = '15m' and candle_open_time = s.signal_time
      limit 1
    ) mf on true
  ),
  mf1h as (
    select m.*, h.structure_trend as st_1h
    from mf15 m
    left join lateral (
      select structure_trend from market_features
      where symbol = 'BTCUSDT' and interval = '1h'
        and candle_open_time + interval '1 hour' <= m.signal_time
      order by candle_open_time desc limit 1
    ) h on true
  ),
  mf4h as (
    select m.*, h.structure_trend as st_4h
    from mf1h m
    left join lateral (
      select structure_trend from market_features
      where symbol = 'BTCUSDT' and interval = '4h'
        and candle_open_time + interval '4 hours' <= m.signal_time
      order by candle_open_time desc limit 1
    ) h on true
  ),
  mf1d as (
    select m.*, h.structure_trend as st_1d
    from mf4h m
    left join lateral (
      select structure_trend from market_features
      where symbol = 'BTCUSDT' and interval = '1d'
        and candle_open_time + interval '1 day' <= m.signal_time
      order by candle_open_time desc limit 1
    ) h on true
  ),
  withpat as (
    select m.*,
      exists(
        select 1 from research_pattern_events pe
        where pe.interval = '15m' and pe.candle_open_time = m.signal_time
          and pe.direction_expected = (case m.direction when 'LONG' then 'BULLISH' else 'BEARISH' end)
      ) as has_pattern
    from mf1d m
  ),
  ins as (
    insert into public.research_triple_barrier_context
      (interval, direction, tp_pct, sl_pct, vertical_bars, signal_time, outcome,
       rsi_14_15m, structure_trend_15m, cvd_trend_15m, adx_14_15m, trend_dir_15m,
       structure_trend_1h, structure_trend_4h, structure_trend_1d, mtf_aligned, has_pattern_matching_direction)
    select
      w.interval, w.direction, w.tp_pct, w.sl_pct, w.vertical_bars, w.signal_time, w.outcome,
      w.rsi_14, w.structure_trend, w.cvd_trend, w.adx_14,
      case when w.plus_di is null or w.minus_di is null then null
           when w.plus_di > w.minus_di then 'bullish' when w.minus_di > w.plus_di then 'bearish' else 'ranging' end,
      w.st_1h, w.st_4h, w.st_1d,
      case when w.st_1h is null or w.st_4h is null or w.st_1d is null then null
           when w.direction = 'LONG' then (w.st_1h = 'bullish' and w.st_4h = 'bullish' and w.st_1d = 'bullish')
           else (w.st_1h = 'bearish' and w.st_4h = 'bearish' and w.st_1d = 'bearish')
      end,
      w.has_pattern
    from withpat w
    on conflict do nothing
    returning 1
  )
  select count(*) from ins;
$$;
