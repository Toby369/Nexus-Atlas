-- Exportiert aus supabase_migrations.schema_migrations (20260914190148 create_regime_evaluation_events_daily_weekday)

-- Nutzer-Wunsch 14.09.2026 ("makro höhere Kerzen ... Wochenende auslassen"):
-- angepasstes Auswertungsfenster speziell für den Makro-Signal-Retest.
--
-- Unterschied zu research_regime_evaluation_events() (die produktive 4h/alle-
-- Wochentage-Basis des Regime-Score-Protokolls):
--   1. Nur EIN Bewertungspunkt pro Tag (00:00 UTC) statt alle 4h -- naeher an
--      der taeglichen Update-Kadenz der Makro-Snapshots (DXY/Gold/S&P/Nasdaq/
--      VIX aktualisieren sich hoechstens einmal pro Handelstag).
--   2. Zielfenster 24h statt 4h (weiterhin 1x ATR(14), weiterhin auf Basis
--      der voll befüllten 1h-Kerzen/atr_14 -- die 1d-Kerzen haben nur fuer
--      252/1471 Tage einen atr_14-Wert, zu duenn fuer einen robusten Test).
--   3. Samstag/Sonntag (UTC) werden als Bewertungspunkt ausgeschlossen: die
--      Makro-Snapshots (Yahoo-Finance-Symbole wie DX-Y.NYB/^GSPC/^VIX) stehen
--      am Wochenende still (Markt geschlossen, macro_snapshots.change_pct
--      wiederholt den Freitagsschluss) -- ein Bewertungspunkt am Wochenende
--      wuerde ein bereits "abgelaufenes" Signal gegen frische BTC-Kursbewegung
--      testen, die mit dem Signal nichts mehr zu tun hat.
--
-- Bewusst als EIGENE Funktion, nicht als Parameter der bestehenden Funktion:
-- research_regime_evaluation_events() bleibt unveraendert die Basis des
-- produktiven Regime-Score-Protokolls (siehe GESAMTEINSCHAETZUNG-SCORE-
-- PROTOCOL_2026-09-12.md) -- dieser Retest ist ein separates, unabhaengiges
-- Experiment fuer die Makro-Signale, kein Ersatz.
create or replace function public.research_regime_evaluation_events_daily_weekday()
returns table(evaluation_time timestamp with time zone, close_price numeric, atr_14 numeric, outcome text, resolution_time timestamp with time zone)
language sql
stable
as $function$
  with t0 as (
    select mf.candle_open_time as evaluation_time, mf.close_price, mf.atr_14
    from market_features mf
    where mf.interval = '1h' and mf.symbol = 'BTCUSDT'
      and mf.atr_14 is not null
      and extract(hour from mf.candle_open_time)::int = 0
      and extract(dow from mf.candle_open_time) not in (0, 6)
  ),
  fwd as (
    select
      t0.evaluation_time, t0.close_price, t0.atr_14,
      c.open_time,
      row_number() over (partition by t0.evaluation_time order by c.open_time) as rn,
      (c.high >= t0.close_price + 1.0 * t0.atr_14) as hit_up,
      (c.low  <= t0.close_price - 1.0 * t0.atr_14) as hit_down
    from t0
    join candles c
      on c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = '1h'
      and c.open_time > t0.evaluation_time
      and c.open_time <= t0.evaluation_time + interval '24 hours'
  ),
  first_hits as (
    select
      evaluation_time, close_price, atr_14,
      max(rn) as max_rn,
      min(rn) filter (where hit_up) as up_rn,
      min(rn) filter (where hit_down) as down_rn,
      min(open_time) filter (where hit_up) as up_time,
      min(open_time) filter (where hit_down) as down_time
    from fwd
    group by evaluation_time, close_price, atr_14
  ),
  resolved as (
    select
      evaluation_time, close_price, atr_14,
      case
        when up_rn is not null and down_rn is not null and up_rn = down_rn then 'NEUTRAL'
        when up_rn is not null and (down_rn is null or up_rn < down_rn) then 'UP'
        when down_rn is not null and (up_rn is null or down_rn < up_rn) then 'DOWN'
        when max_rn >= 24 then 'NEUTRAL'
        else null
      end as outcome,
      case
        when up_rn is not null and down_rn is not null and up_rn = down_rn then up_time
        when up_rn is not null and (down_rn is null or up_rn < down_rn) then up_time
        when down_rn is not null and (up_rn is null or down_rn < up_rn) then down_time
        when max_rn >= 24 then evaluation_time + interval '24 hours'
        else null
      end as resolution_time
    from first_hits
  )
  select evaluation_time, close_price, atr_14, outcome, resolution_time
  from resolved
  where outcome is not null;
$function$;
