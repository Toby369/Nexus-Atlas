-- Exportiert aus supabase_migrations.schema_migrations (20260827052709 create_backtest_states_and_reconstruction)


-- Phase 4 (Historical State Reconstruction): additive Backtest-DB-Modell.
-- Ruehrt KEINE bestehende Tabelle/Funktion an. compute-market-state,
-- market_states, get_macro_regime(), get_funding_intelligence() bleiben
-- unveraendert und laufen produktiv unabhaengig weiter.
--
-- WICHTIG -- Point-in-Time-Grenze (bewusst, nicht versteckt):
-- Nur Faktoren, deren Rohdaten OHNE now()-Abhaengigkeit rekonstruierbar
-- sind, werden hier berechnet:
--   - 8 Faktoren direkt aus market_features (structure, momentum, cvd,
--     oi_price, trend_strength, trend_regime, vwap_position, basis) --
--     diese Tabelle ist bereits eine historische Zeitreihe, keine
--     now()-Abfrage noetig.
--   - funding -- eigene "asof"-Rekonstruktion gegen market_snapshots
--     (juengster Wert je Boerse VOR ODER GLEICH dem Kerzen-Schluss),
--     NICHT ueber die produktive get_funding_intelligence()-RPC (die
--     rechnet fest gegen now() und wuerde sonst live/zukuenftige Daten
--     in historische Zeilen einschleusen -- genau der Look-ahead-Bias,
--     den Phase 9 der Spec explizit verhindern soll).
--
-- Die verbleibenden 5 Faktoren (positioning, orderbook, options, macro,
-- sentiment) werden HIER BEWUSST NICHT rekonstruiert und bleiben null:
-- positioning/orderbook/options/sentiment haben laut Phase-3-Audit real
-- nur 14 Stunden bis 3 Tage Historie (Grossteil des Backtest-Fensters
-- waere ohnehin ungedeckt), und macro (get_macro_regime) ist wie funding
-- fest an now() gebunden -- eine korrekte asof-Rekonstruktion dieser
-- 5-fach-Aggregation ist nicht trivial und wird explizit dem separaten
-- Look-ahead-Schutz-Schritt (Phase 9) ueberlassen, statt hier eine
-- Nherung vorzutaeuschen. "unreconstructed_factors" dokumentiert das
-- pro Zeile maschinenlesbar.
--
-- Schwellenwerte sind 1:1 aus compute-market-state v8 gespiegelt (RSI
-- 55/45, OI-Delta 0.3%, ADX 20, VWAP-Band 0.15%, Basis/Funding-Extreme
-- 0.15%/0.05%). Das ist bewusste Duplikation der Klassifikations-LOGIK
-- (nicht der Rohdaten-Sammlung) und muss manuell synchron gehalten
-- werden, falls compute-market-state seine Schwellen aendert -- ein
-- bekannter, dokumentierter Nachteil dieses ersten Backtest-Ansatzes,
-- kein versteckter Bug.

create table if not exists public.backtest_states (
  id bigserial primary key,
  timestamp_utc timestamptz not null,       -- Kerzen-Schlusszeit (candle_open_time + Intervall)
  candle_open_time timestamptz not null,
  interval text not null,
  factors jsonb not null,                   -- gleiche Struktur wie market_states.factors
  unreconstructed_factors text[] not null,  -- z.B. ['positioning','orderbook','options','macro','sentiment']
  domain_result jsonb not null,             -- Output von experimental_domain_signal_state()
  architecture_version text not null,
  point_in_time_safe boolean not null default true,
  computed_at timestamptz not null default now(),
  unique (candle_open_time, interval, architecture_version)
);

alter table public.backtest_states enable row level security;

create policy "backtest_states_select_all" on public.backtest_states
  for select using (true);

revoke all on public.backtest_states from anon, authenticated;
grant select on public.backtest_states to anon, authenticated, service_role;
grant insert on public.backtest_states to service_role;

create or replace function public.backtest_reconstruct_1h_states(p_from timestamptz default null, p_to timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with mf as (
    select *
    from market_features
    where symbol = 'BTCUSDT' and interval = '1h'
      and (p_from is null or candle_open_time >= p_from)
      and (p_to is null or candle_open_time <= p_to)
  ),
  ct as (
    select *, candle_open_time + interval '1 hour' as close_time_utc from mf
  ),
  funding_asof as (
    select
      ct.candle_open_time,
      (
        select avg(m.funding_rate)
        from (
          select distinct on (exchange) exchange, funding_rate
          from market_snapshots
          where status = 'ok' and funding_rate is not null
            and timestamp_utc <= ct.close_time_utc
          order by exchange, timestamp_utc desc
        ) m
      ) as avg_funding_rate
    from ct
  ),
  computed as (
    select
      ct.candle_open_time,
      ct.close_time_utc,
      jsonb_build_object(
        'structure', jsonb_build_object(
          'value', case when ct.structure_trend = 'bullish' then 1 when ct.structure_trend = 'bearish' then -1 else 0 end,
          'basis', jsonb_build_object('structure_trend', ct.structure_trend)),
        'momentum', jsonb_build_object(
          'value', case when ct.rsi_14 is null or ct.macd_histogram is null then null
                        when ct.rsi_14 > 55 and ct.macd_histogram > 0 then 1
                        when ct.rsi_14 < 45 and ct.macd_histogram < 0 then -1
                        else 0 end,
          'basis', jsonb_build_object('rsi_14', ct.rsi_14, 'macd_histogram', ct.macd_histogram)),
        'cvd', jsonb_build_object(
          'value', case when ct.cvd_trend = 'rising' then 1 when ct.cvd_trend = 'falling' then -1 else 0 end,
          'basis', jsonb_build_object('cvd_trend', ct.cvd_trend)),
        'oi_price', jsonb_build_object(
          'value', case when ct.oi_delta_pct is null or ct.close_price is null or ct.ema_20 is null then null
                        when abs(ct.oi_delta_pct) > 0.3 then (case when ct.close_price > ct.ema_20 then 1 else -1 end)
                        else 0 end,
          'basis', jsonb_build_object('oi_delta_pct', ct.oi_delta_pct)),
        'trend_strength', jsonb_build_object(
          'value', case when ct.adx_14 is null or ct.plus_di is null or ct.minus_di is null then null
                        when ct.adx_14 < 20 then 0
                        when ct.plus_di > ct.minus_di then 1
                        when ct.minus_di > ct.plus_di then -1
                        else 0 end,
          'basis', jsonb_build_object('adx_14', ct.adx_14)),
        'trend_regime', jsonb_build_object(
          'value', case when ct.close_price is null or ct.ema_50 is null or ct.ema_200 is null then null
                        when ct.close_price > ct.ema_50 and ct.ema_50 > ct.ema_200 then 1
                        when ct.close_price < ct.ema_50 and ct.ema_50 < ct.ema_200 then -1
                        else 0 end,
          'basis', jsonb_build_object('ema_50', ct.ema_50, 'ema_200', ct.ema_200)),
        'vwap_position', jsonb_build_object(
          'value', case when ct.vwap is null or ct.close_price is null or ct.vwap = 0 then null
                        when ((ct.close_price - ct.vwap) / ct.vwap) * 100 > 0.15 then 1
                        when ((ct.close_price - ct.vwap) / ct.vwap) * 100 < -0.15 then -1
                        else 0 end,
          'basis', jsonb_build_object('vwap', ct.vwap)),
        'basis', jsonb_build_object(
          'value', case when ct.basis_pct is null then null
                        when ct.basis_pct > 0.15 then -1
                        when ct.basis_pct < -0.15 then 1
                        else 0 end,
          'basis', jsonb_build_object('basis_pct', ct.basis_pct)),
        'funding', jsonb_build_object(
          'value', case when fa.avg_funding_rate is null then null
                        when fa.avg_funding_rate > 0.0005 then -1
                        when fa.avg_funding_rate < -0.0005 then 1
                        else 0 end,
          'basis', jsonb_build_object('avg_funding_rate', fa.avg_funding_rate)),
        'positioning', jsonb_build_object('value', null, 'basis', '{}'::jsonb),
        'orderbook', jsonb_build_object('value', null, 'basis', '{}'::jsonb),
        'options', jsonb_build_object('value', null, 'basis', '{}'::jsonb),
        'macro', jsonb_build_object('value', null, 'basis', '{}'::jsonb),
        'sentiment', jsonb_build_object('value', null, 'basis', '{}'::jsonb)
      ) as factors
    from ct
    left join funding_asof fa on fa.candle_open_time = ct.candle_open_time
  )
  insert into public.backtest_states (timestamp_utc, candle_open_time, interval, factors, unreconstructed_factors, domain_result, architecture_version, point_in_time_safe)
  select
    c.close_time_utc,
    c.candle_open_time,
    '1h',
    c.factors,
    array['positioning','orderbook','options','macro','sentiment'],
    public.experimental_domain_signal_state(c.factors),
    'experimental_domain_v1_phase3',
    true
  from computed c
  on conflict (candle_open_time, interval, architecture_version) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.backtest_reconstruct_1h_states(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.backtest_reconstruct_1h_states(timestamptz, timestamptz) to service_role;
