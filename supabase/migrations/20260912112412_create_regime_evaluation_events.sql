-- Exportiert aus supabase_migrations.schema_migrations (20260912112412 create_regime_evaluation_events)

-- Gesamteinschaetzung-Score-Protokoll (docs/research/GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md)
-- Abschnitt 1+4+8 Schritt 1: nicht-ueberlappende 4h-Bewertungspunkte mit
-- ATR-skalierten Doppel-Barriere-Ausgaengen (UP/DOWN/NEUTRAL).
--
-- Tie-Break bei Ambiguitaet (beide Barrieren in derselben Stunden-Kerze
-- beruehrt -- ohne Tick-Daten nicht auflösbar, welche zuerst kam): NEUTRAL
-- statt einer erfundenen Reihenfolge -- gleiche "keine Daten statt
-- erfundenem Wert"-Philosophie wie ueberall sonst im Projekt.
--
-- Unvollstaendige Fenster (noch nicht 4h seit t0 vergangen, z.B. die
-- juengsten Bewertungspunkte nahe "jetzt") werden nur dann als NEUTRAL
-- gewertet, wenn wirklich alle 4 Stunden-Kerzen vorliegen -- ein frueher
-- UP/DOWN-Treffer zaehlt dagegen auch bei einem noch unvollstaendigen
-- Fenster (das Ergebnis steht ja bereits fest), sonst werden solche Punkte
-- ganz ausgeschlossen (weder UP/DOWN/NEUTRAL, noch nicht entscheidbar).
create or replace function research_regime_evaluation_events()
returns table(
  evaluation_time timestamptz,
  close_price numeric,
  atr_14 numeric,
  outcome text,
  resolution_time timestamptz
)
language sql
stable
as $$
  with t0 as (
    select mf.candle_open_time as evaluation_time, mf.close_price, mf.atr_14
    from market_features mf
    where mf.interval = '1h' and mf.symbol = 'BTCUSDT'
      and mf.atr_14 is not null
      and extract(hour from mf.candle_open_time)::int % 4 = 0
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
      and c.open_time <= t0.evaluation_time + interval '4 hours'
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
        when max_rn >= 4 then 'NEUTRAL'
        else null
      end as outcome,
      case
        when up_rn is not null and down_rn is not null and up_rn = down_rn then up_time
        when up_rn is not null and (down_rn is null or up_rn < down_rn) then up_time
        when down_rn is not null and (up_rn is null or down_rn < up_rn) then down_time
        when max_rn >= 4 then evaluation_time + interval '4 hours'
        else null
      end as resolution_time
    from first_hits
  )
  select evaluation_time, close_price, atr_14, outcome, resolution_time
  from resolved
  where outcome is not null;
$$;

comment on function research_regime_evaluation_events() is
  'Gesamteinschaetzung-Score-Protokoll Abschnitt 1+4: nicht-ueberlappende 4h-Bewertungspunkte '
  '(1h-Kerzenraster, alle 4h ein Punkt) mit ATR14-skaliertem symmetrischem Doppel-Barriere-Ausgang '
  '(k=1,0, H=4h, siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md).';
