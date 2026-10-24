-- Exportiert aus supabase_migrations.schema_migrations (20260912113137 create_regime_signal_activation)

-- Gesamteinschaetzung-Score-Protokoll Abschnitt 8 Schritt 2: Signal-Zustand
-- je Bewertungspunkt. Schema bewusst analog research_confluence_signal_activation
-- (direction/outcome/is_active), aber evaluation_time statt setup_id als
-- Schluessel, da es hier keine getrennten LONG-/SHORT-Ketten gibt -- pro
-- Bewertungspunkt zwei Hypothesen-Zeilen (UP/DOWN), je mit is_active =
-- "zeigte das Signal zu diesem Zeitpunkt in diese Richtung".
--
-- ERSTE RUNDE: 17 von 39 vorregistrierten Kandidaten (13 aus dem
-- Confluence-Score-Protokoll mit bereits bewaehrter Rekonstruktionslogik,
-- reine "Leading"-Neuinterpretation von Momentum-Faktor da hier kein
-- Confirming-Konzept existiert, siehe Abschnitt 3; plus 4 der 8 neuen
-- Regime-Matrix-Signale mit voller 4-Jahres-Historie und eindeutiger
-- Richtungs-Hypothese). Bewusst NICHT in dieser Runde: Funding-Z-Score,
-- OI-vs-Preis-Quadrant, Liquidation-Cluster-Density, Net-Taker-Flow-Ratio
-- (n=400-470 total in market_state_matrix -- Live-Collector-abhaengig,
-- nicht rueckwirkend backfillbar, siehe Kommentar in backfill-history/
-- index.ts) sowie die 18 verbleibenden Original-31-Signale ohne bereits
-- reproduzierbare Klassifizierungslogik (Funding roh, Positionierung,
-- Optionen, Divergenz-Radar x3, Warn-Muster x4, TradingView x8) -- als
-- spaetere Erweiterung vorgemerkt, keine rueckwirkende Aenderung an dieser
-- ersten Runde noetig (identisches Erweiterungs-Prinzip wie beim
-- Setup-Score, siehe CONFLUENCE-SCORE-PHASE3-RESULTS_2026-09-11.md
-- Abschnitt 6: "13 gesicherte Signale zuerst, Rest folgt").

create table if not exists research_regime_signal_activation (
  id bigint generated always as identity primary key,
  evaluation_time timestamptz not null,
  signal_a text not null,
  direction text not null check (direction in ('UP','DOWN')),
  outcome text not null check (outcome in ('UP','DOWN','NEUTRAL')),
  is_active boolean not null,
  computed_at timestamptz not null default now(),
  unique (evaluation_time, signal_a, direction)
);

alter table research_regime_signal_activation enable row level security;
create policy "Public read access" on research_regime_signal_activation for select to public using (true);

create index if not exists idx_regime_activation_signal on research_regime_signal_activation (signal_a, direction);

create or replace function research_regime_extend_activation()
returns void
language plpgsql
as $function$
begin
  -- Struktur 15m/1h/4h/1d (Leading, Toleranzen wie Confluence-Score-Protokoll 6b)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Struktur 15m', dir.direction, e.outcome,
    coalesce((
      select m.structure_trend = (case when dir.direction = 'UP' then 'bullish' else 'bearish' end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Struktur 1h', dir.direction, e.outcome,
    coalesce((
      select m.structure_trend = (case when dir.direction = 'UP' then 'bullish' else 'bearish' end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1h' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Struktur 4h', dir.direction, e.outcome,
    coalesce((
      select m.structure_trend = (case when dir.direction = 'UP' then 'bullish' else 'bearish' end)
             and e.evaluation_time - m.candle_open_time <= interval '8 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '4h' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Struktur 1d', dir.direction, e.outcome,
    coalesce((
      select m.structure_trend = (case when dir.direction = 'UP' then 'bullish' else 'bearish' end)
             and e.evaluation_time - m.candle_open_time <= interval '30 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1d' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- MTF-Alignment (striktes 3-Way-Match 1h/4h/1d, je eigene Toleranz)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'MTF-Alignment', dir.direction, e.outcome,
    coalesce((
      select
        (m1h.structure_trend = tgt and e.evaluation_time - m1h.candle_open_time <= interval '4 hours')
        and (m4h.structure_trend = tgt and e.evaluation_time - m4h.candle_open_time <= interval '8 hours')
        and (m1d.structure_trend = tgt and e.evaluation_time - m1d.candle_open_time <= interval '30 hours')
      from
        (select case when dir.direction = 'UP' then 'bullish' else 'bearish' end as tgt) t,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='1h' and candle_open_time <= e.evaluation_time
                 order by candle_open_time desc limit 1) m1h,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='4h' and candle_open_time <= e.evaluation_time
                 order by candle_open_time desc limit 1) m4h,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='1d' and candle_open_time <= e.evaluation_time
                 order by candle_open_time desc limit 1) m1d
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- CVD-Richtung (15m, Toleranz 4h)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CVD-Richtung', dir.direction, e.outcome,
    coalesce((
      select m.cvd_trend = (case when dir.direction = 'UP' then 'rising' else 'falling' end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Trendstaerke (ADX+DI), 15m, Toleranz 4h
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Trendstaerke (ADX+DI)', dir.direction, e.outcome,
    coalesce((
      select m.adx_14 >= 20
             and (case when dir.direction = 'UP' then m.plus_di > m.minus_di else m.minus_di > m.plus_di end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Trend-Regime (EMA50/200), 15m, Toleranz 4h
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Trend-Regime (EMA50/200)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then m.ema_50 > m.ema_200 else m.ema_50 < m.ema_200 end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- VWAP-Position, 15m, Toleranz 4h
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'VWAP-Position', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then m.close_price > m.vwap else m.close_price < m.vwap end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Fear & Greed (kontrarisch, Toleranz 30h)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Fear & Greed', dir.direction, e.outcome,
    coalesce((
      select s.classification = (case when dir.direction = 'UP' then 'Extreme Fear' else 'Extreme Greed' end)
             and e.evaluation_time - s.timestamp_utc <= interval '30 hours'
      from sentiment_snapshots s
      where s.source = 'alternative.me' and s.timestamp_utc <= e.evaluation_time
      order by s.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Makro-Regime (Risk-On->UP, Risk-Off->DOWN)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Makro-Regime', dir.direction, e.outcome,
    coalesce(
      (get_macro_regime_asof(e.evaluation_time) ->> 'regime') =
      (case when dir.direction = 'UP' then 'Risk-On' else 'Risk-Off' end),
      false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Orderbuch-Imbalance (Toleranz 4h, Schwelle 0.08 Betrag)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Orderbuch-Imbalance', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then o.depth_imbalance > 0.08 else o.depth_imbalance < -0.08 end)
             and e.evaluation_time - o.timestamp_utc <= interval '4 hours'
      from orderbook_snapshots o
      where o.exchange = 'binance' and o.symbol = 'BTCUSDT' and o.timestamp_utc <= e.evaluation_time
      order by o.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Momentum-Faktor (RSI+MACD) -- hier reine Leading-Neuinterpretation
  -- (Zustand AM Bewertungszeitpunkt, kein Confirming-Warten auf +0,25%,
  -- siehe Abschnitt 3 des Protokolls), 15m, Toleranz 4h.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Momentum-Faktor (RSI+MACD)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then m.rsi_14 > 50 and m.macd_histogram > 0
                   else m.rsi_14 < 50 and m.macd_histogram < 0 end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Regressionssteigung (Regime-Matrix, 1h, Trendfolge: positive Steigung -> UP)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Regressionssteigung', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.linreg_slope > 0 else rm.linreg_slope < 0 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Distanz-zu-SMA50-Z-Score (Regime-Matrix, 1h, Mean-Reversion: stark ueber
  -- SMA50 -> DOWN-Hypothese, stark darunter -> UP-Hypothese, Schwelle |z|>=1,5)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Distanz-SMA50-Z (Mean-Reversion)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.dist_zscore_sma50 <= -1.5 else rm.dist_zscore_sma50 >= 1.5 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- CVD-Z-Score (Regime-Matrix, 1h, Trendfolge, Schwelle |z|>=1,0 -- eigene
  -- Operationalisierung neben dem Roh-Vorzeichen "CVD-Richtung" oben)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CVD-Z-Score', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.cvd_zscore >= 1.0 else rm.cvd_zscore <= -1.0 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Bollinger %b (Regime-Matrix, 1h, Mean-Reversion: nahe/ueber oberem Band
  -- -> DOWN-Hypothese, nahe/unter unterem Band -> UP-Hypothese)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Bollinger %b (Mean-Reversion)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.bb_percent_b <= 0.2 else rm.bb_percent_b >= 0.8 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

comment on function research_regime_extend_activation() is
  'Gesamteinschaetzung-Score-Protokoll Abschnitt 8 Schritt 2, erste Runde (17 von 39 Kandidaten) -- '
  'siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md.';
