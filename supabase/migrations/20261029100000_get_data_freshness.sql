-- Datenstand je Quelle fuer die Ampel in der Kopfzeile und "Stand vor X Min"
-- im Kachelkopf (docs/research/AUTARK-BAUWEISE-FUER-NEXUS_2026-10-29.md,
-- Punkt A/B). Liefert nur den juengsten Zeitstempel je Quelle; Takt, Namen
-- und Bewertung stehen in lib/dataFreshness.ts (eine Stelle, getestet).
--
-- Bewusst KEINE neue Tabelle und keine Aenderung an den Sammlern: die
-- Datenbank liegt bei ~410 von 500 MB, und das Neueste je Quelle steht schon
-- in den Rohdaten. data_quality (refresh_data_quality, stuendlich) bleibt
-- unveraendert -- sie ist fuer die Kachel-Anzeige zu traege (bis 60 Min alt)
-- und kennt Bitunix/Pionex nicht.
--
-- Kosten: jede Abfrage laeuft ueber einen vorhandenen Zeit-Index und ein
-- begrenztes Fenster (24 Std), die kleinen Tabellen (etf_flows, onchain,
-- Kalender, Briefings) werden ganz gelesen. Fehlt eine Quelle im Fenster,
-- kommt null -- die App zeigt dann "seit ueber 24 Std keine Daten".
--
-- Liquidationen fehlen absichtlich: keine Liquidation heisst ruhiger Markt,
-- nicht Ausfall des Sammlers.
create or replace function public.get_data_freshness()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fenster as (select now() - interval '1 day' as ab)
  select coalesce(jsonb_object_agg(k, ts), '{}'::jsonb)
  from (
    select 'futures_' || exchange as k, max(timestamp_utc) as ts
      from market_snapshots, fenster
      where timestamp_utc > fenster.ab and status = 'ok'
      group by exchange
    union all
    select 'positioning_' || exchange, max(timestamp_utc)
      from positioning_snapshots, fenster
      where timestamp_utc > fenster.ab
      group by exchange
    union all
    select 'orderbook_' || exchange, max(timestamp_utc)
      from orderbook_snapshots, fenster
      where timestamp_utc > fenster.ab
      group by exchange
    union all
    select 'spot_binance', max(timestamp_utc)
      from spot_market_snapshots, fenster
      where timestamp_utc > fenster.ab and exchange = 'binance'
    union all
    select 'spot_volume', max(updated_at) from spot_volume_profile_cursor
    union all
    select 'candles_' || i, (
      select max(open_time) from candles
      where exchange = 'binance' and symbol = 'BTCUSDT' and interval = i
    )
      from unnest(array['15m', '1h', '1d']) as i
    union all
    select 'market_state', max(timestamp_utc) from market_states, fenster where timestamp_utc > fenster.ab
    union all
    select 'regime_matrix', max(timestamp_utc) from market_state_matrix, fenster where timestamp_utc > fenster.ab
    union all
    select 'divergence_radar', max(snapshotted_at) from divergence_radar_snapshots, fenster where snapshotted_at > fenster.ab
    union all
    select 'term_basis', max(timestamp_utc) from term_basis_snapshots, fenster where timestamp_utc > fenster.ab
    union all
    select 'sentiment', max(timestamp_utc) from sentiment_snapshots, fenster where timestamp_utc > fenster.ab
    union all
    select 'options', max(timestamp_utc) from options_snapshots, fenster where timestamp_utc > fenster.ab
    union all
    select 'macro', max(timestamp_utc) from macro_snapshots, fenster where timestamp_utc > fenster.ab
    union all
    select 'news', max(created_at) from news_events
    union all
    select 'onchain', max(created_at) from onchain_snapshots
    union all
    select 'etf', max(created_at) from etf_flows
    union all
    select 'calendar', max(updated_at) from economic_calendar_events
    union all
    select 'briefing', max(generated_at) from system_briefings
    union all
    select 'autark_sync', max(last_sync_at) from autark_sync_status
  ) q;
$$;

revoke all on function public.get_data_freshness() from public;
grant execute on function public.get_data_freshness() to anon, authenticated;
