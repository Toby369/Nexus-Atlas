-- Exportiert aus supabase_migrations.schema_migrations (20260911203325 create_confluence_pipeline_extend_functions)

-- Confluence-Score Pipeline-Integration (Abschnitt 8 des Protokolls)
-- research_confluence_extend_chain(): erweitert die sequenzielle Setup-Kette
-- research_confluence_extend_activation(): erweitert Aktivierung fuer 13 gesicherte Signale
-- research_confluence_refresh_stats(): rechnet Einzelsignal- + Paar-Zellen (Variante A) neu

create or replace function research_confluence_extend_chain()
returns table(direction text, inserted_count integer)
language plpgsql
as $$
declare
  v_dir text;
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
begin
  foreach v_dir in array array['LONG','SHORT'] loop
    select coalesce(max(resolution_time), '2024-09-11'::timestamptz) + interval '15 minutes'
      into v_start
    from research_swing_setup_chain_results
    where direction = v_dir and interval = '15m' and tp_pct = 1.75 and sl_pct = 0.5
      and retrace_pct = 0.25 and vertical_bars = 192;

    select max(candle_open_time) into v_end
    from market_features where symbol = 'BTCUSDT' and interval = '15m';

    insert into research_swing_setup_chain_results
      (interval, direction, tp_pct, sl_pct, retrace_pct, vertical_bars,
       signal_time, entry_time, entry_price, outcome, resolution_time, bars_to_resolution, mfe_pct)
    select '15m', v_dir, 1.75, 0.5, 0.25, 192,
           e.signal_time, e.entry_time, e.entry_price, e.outcome, e.resolution_time, e.bars_to_resolution, e.mfe_pct
    from research_swing_setup_chain_events('15m', v_dir, 1.75, 0.5, 0.25, 192, v_start, v_end) e;

    get diagnostics v_count = row_count;
    direction := v_dir;
    inserted_count := v_count;
    return next;
  end loop;
end;
$$;

create or replace function research_confluence_extend_activation()
returns void
language plpgsql
as $$
begin
  -- Struktur 15m (Leading, Toleranz 4h)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Struktur 15m', c.direction, c.outcome,
    coalesce((
      select m.structure_trend = (case when c.direction = 'LONG' then 'bullish' else 'bearish' end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Struktur 15m');

  -- Struktur 1h (Leading, Toleranz 4h)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Struktur 1h', c.direction, c.outcome,
    coalesce((
      select m.structure_trend = (case when c.direction = 'LONG' then 'bullish' else 'bearish' end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1h' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Struktur 1h');

  -- Struktur 4h (Leading, Toleranz 8h)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Struktur 4h', c.direction, c.outcome,
    coalesce((
      select m.structure_trend = (case when c.direction = 'LONG' then 'bullish' else 'bearish' end)
             and c.entry_time - m.candle_open_time <= interval '8 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '4h' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Struktur 4h');

  -- Struktur 1d (Leading, Toleranz 30h)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Struktur 1d', c.direction, c.outcome,
    coalesce((
      select m.structure_trend = (case when c.direction = 'LONG' then 'bullish' else 'bearish' end)
             and c.entry_time - m.candle_open_time <= interval '30 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1d' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Struktur 1d');

  -- MTF-Alignment (Leading, striktes 3-Way-Match 1h/4h/1d, je eigene Toleranz)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'MTF-Alignment', c.direction, c.outcome,
    coalesce((
      select
        (m1h.structure_trend = tgt and c.entry_time - m1h.candle_open_time <= interval '4 hours')
        and (m4h.structure_trend = tgt and c.entry_time - m4h.candle_open_time <= interval '8 hours')
        and (m1d.structure_trend = tgt and c.entry_time - m1d.candle_open_time <= interval '30 hours')
      from
        (select case when c.direction = 'LONG' then 'bullish' else 'bearish' end as tgt) t,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='1h' and candle_open_time <= c.entry_time
                 order by candle_open_time desc limit 1) m1h,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='4h' and candle_open_time <= c.entry_time
                 order by candle_open_time desc limit 1) m4h,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='1d' and candle_open_time <= c.entry_time
                 order by candle_open_time desc limit 1) m1d
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'MTF-Alignment');

  -- CVD-Richtung (Leading, Toleranz 4h, 15m)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'CVD-Richtung', c.direction, c.outcome,
    coalesce((
      select m.cvd_trend = (case when c.direction = 'LONG' then 'rising' else 'falling' end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'CVD-Richtung');

  -- Trendstaerke (ADX+DI) (Leading, Toleranz 4h, 15m; ADX>=20 + DI-Richtung)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Trendstaerke (ADX+DI)', c.direction, c.outcome,
    coalesce((
      select m.adx_14 >= 20
             and (case when c.direction = 'LONG' then m.plus_di > m.minus_di else m.minus_di > m.plus_di end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Trendstaerke (ADX+DI)');

  -- Trend-Regime (EMA50/200) (Leading, Toleranz 4h, 15m)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Trend-Regime (EMA50/200)', c.direction, c.outcome,
    coalesce((
      select (case when c.direction = 'LONG' then m.ema_50 > m.ema_200 else m.ema_50 < m.ema_200 end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Trend-Regime (EMA50/200)');

  -- VWAP-Position (Leading, Toleranz 4h, 15m)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'VWAP-Position', c.direction, c.outcome,
    coalesce((
      select (case when c.direction = 'LONG' then m.close_price > m.vwap else m.close_price < m.vwap end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'VWAP-Position');

  -- Fear & Greed (Leading, Toleranz 30h, kontrarisch: Extreme Fear->LONG, Extreme Greed->SHORT)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Fear & Greed', c.direction, c.outcome,
    coalesce((
      select s.classification = (case when c.direction = 'LONG' then 'Extreme Fear' else 'Extreme Greed' end)
             and c.entry_time - s.timestamp_utc <= interval '30 hours'
      from sentiment_snapshots s
      where s.source = 'alternative.me' and s.timestamp_utc <= c.entry_time
      order by s.timestamp_utc desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Fear & Greed');

  -- Makro-Regime (Leading, Risk-On->LONG, Risk-Off->SHORT)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Makro-Regime', c.direction, c.outcome,
    coalesce(
      (get_macro_regime_asof(c.entry_time) ->> 'regime') =
      (case when c.direction = 'LONG' then 'Risk-On' else 'Risk-Off' end),
      false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Makro-Regime');

  -- Orderbuch-Imbalance (Leading, Toleranz 4h; Schwelle 0.08 Betrag)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Orderbuch-Imbalance', c.direction, c.outcome,
    coalesce((
      select (case when c.direction = 'LONG' then o.depth_imbalance > 0.08 else o.depth_imbalance < -0.08 end)
             and c.entry_time - o.timestamp_utc <= interval '4 hours'
      from orderbook_snapshots o
      where o.exchange = 'binance' and o.symbol = 'BTCUSDT' and o.timestamp_utc <= c.entry_time
      order by o.timestamp_utc desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Orderbuch-Imbalance');

  -- Momentum-Faktor (RSI+MACD) (Confirming: Entry bis Preis+0.25%-Marge, RSI/MACD in Trendrichtung
  -- irgendwann im Fenster aktiv; ~92% Rekonstruktions-Genauigkeit ggue. historischer Klassifizierung,
  -- siehe Doku-Nachtrag -- kleines Genauigkeits-Risiko bewusst in Kauf genommen, da Signal bereits
  -- gesichert BH-FDR-signifikant ist und neue Zeilen die Gesamtkraft kaum veraendern)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Momentum-Faktor (RSI+MACD)', c.direction, c.outcome,
    coalesce((
      select exists (
        select 1 from market_features m
        where m.symbol = 'BTCUSDT' and m.interval = '15m'
          and m.candle_open_time >= c.entry_time and m.candle_open_time <= t.t_confirm
          and (case when c.direction = 'LONG' then m.rsi_14 > 50 and m.macd_histogram > 0
                    else m.rsi_14 < 50 and m.macd_histogram < 0 end)
      )
      from lateral (
        select min(k.open_time) as t_confirm from candles k
        where k.exchange = 'binance' and k.symbol = 'BTCUSDT' and k.interval = '15m'
          and k.open_time > c.entry_time and k.open_time <= c.resolution_time
          and (case when c.direction = 'LONG' then k.high >= c.entry_price * 1.0025
                    else k.low <= c.entry_price * 0.9975 end)
      ) t
      where t.t_confirm is not null
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Momentum-Faktor (RSI+MACD)');
end;
$$;

-- 13 gesicherte Signale (2 eingefrorene Signale -- Positionierung, Divergenz-Radar: Onchain vs
-- Preis -- bleiben aussen vor, ihre historischen Zellen in research_confluence_signal_stats
-- werden von diesem Refresh nicht beruehrt).
create or replace function research_confluence_refresh_stats()
returns void
language plpgsql
as $$
declare
  v_signals text[] := array[
    'CVD-Richtung', 'Fear & Greed', 'Makro-Regime', 'Momentum-Faktor (RSI+MACD)',
    'MTF-Alignment', 'Orderbuch-Imbalance', 'Struktur 15m', 'Struktur 1h', 'Struktur 4h',
    'Struktur 1d', 'Trend-Regime (EMA50/200)', 'Trendstaerke (ADX+DI)', 'VWAP-Position'
  ];
begin
  -- Einzelsignal-Zellen
  delete from research_confluence_signal_stats
  where pool = 'main' and cell_type = 'signal' and signal_a = any(v_signals);

  insert into research_confluence_signal_stats
    (cell_type, pool, signal_a, signal_b, direction, window_start, window_end, n1, x1, n2, x2)
  select
    'signal', 'main', r.signal_a, null, r.direction,
    min(c.entry_time), max(c.entry_time),
    count(*) filter (where r.is_active),
    count(*) filter (where r.is_active and r.outcome = 'TRAIL_EXIT'),
    count(*) filter (where not r.is_active),
    count(*) filter (where not r.is_active and r.outcome = 'TRAIL_EXIT')
  from research_confluence_signal_activation r
  join research_swing_setup_chain_results c on c.id = r.setup_id
  where r.signal_a = any(v_signals)
  group by r.signal_a, r.direction;

  -- Paar-Zellen (Variante A: alle Paare unter den 13 Signalen, je Richtung, A < B)
  delete from research_confluence_signal_stats
  where pool = 'main' and cell_type = 'pair_a' and signal_a = any(v_signals) and signal_b = any(v_signals);

  insert into research_confluence_signal_stats
    (cell_type, pool, signal_a, signal_b, direction, window_start, window_end, n1, x1, n2, x2)
  select
    'pair_a', 'main', a.signal_a, b.signal_a, a.direction,
    min(c.entry_time), max(c.entry_time),
    count(*) filter (where a.is_active and b.is_active),
    count(*) filter (where a.is_active and b.is_active and a.outcome = 'TRAIL_EXIT'),
    count(*) filter (where not (a.is_active and b.is_active)),
    count(*) filter (where not (a.is_active and b.is_active) and a.outcome = 'TRAIL_EXIT')
  from research_confluence_signal_activation a
  join research_confluence_signal_activation b
    on b.setup_id = a.setup_id and b.direction = a.direction and b.signal_a > a.signal_a
  join research_swing_setup_chain_results c on c.id = a.setup_id
  where a.signal_a = any(v_signals) and b.signal_a = any(v_signals)
  group by a.signal_a, b.signal_a, a.direction;

  -- Wilson-CI, Z-Test, p-Wert, MIN_N-Gate fuer alle frisch eingefuegten Zellen dieses Laufs
  update research_confluence_signal_stats s
  set hit_rate1_pct = case when s.n1 > 0 then round(100.0 * s.x1 / s.n1, 1) else null end,
      hit_rate2_pct = case when s.n2 > 0 then round(100.0 * s.x2 / s.n2, 1) else null end,
      wilson1_lower = w1.lower, wilson1_upper = w1.upper,
      wilson2_lower = w2.lower, wilson2_upper = w2.upper,
      z_score = zt.z_score, raw_p_value = zt.raw_p_value,
      min_n_met = (s.n1 >= 10 and s.n2 >= 10),
      raw_significant = (s.n1 >= 10 and s.n2 >= 10 and zt.raw_p_value is not null and zt.raw_p_value < 0.05),
      computed_at = now()
  from research_wilson_ci(s.x1, s.n1) w1
  cross join research_wilson_ci(s.x2, s.n2) w2
  cross join research_two_proportion_ztest(s.x1, s.n1, s.x2, s.n2) zt
  where s.pool = 'main'
    and ((s.cell_type = 'signal' and s.signal_a = any(v_signals))
         or (s.cell_type = 'pair_a' and s.signal_a = any(v_signals) and s.signal_b = any(v_signals)));
end;
$$;
