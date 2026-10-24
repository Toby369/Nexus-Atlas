-- Exportiert aus supabase_migrations.schema_migrations (20260828205531 create_get_market_snapshot_exchange_first_seen)

-- Frueheste je gemeldete market_snapshots-Zeile pro Boerse (status='ok').
-- Wird gebraucht, um zu erkennen, ob sich die Boersen-MENGE innerhalb
-- eines gewaehlten Zeitfensters veraendert hat (z.B. OKX/Bitget wurden
-- nach BTC/USDT-Start hinzugefuegt) -- get_market_series/
-- get_market_reference_snapshot summieren OI ueber ein FESTES
-- Boersen-Array, ignorieren aber Boersen ohne Daten zu einem Zeitpunkt
-- stillschweigend (SQL sum() ueberspringt NULL). Das ist fuer eine reine
-- "aktueller Stand"-Anzeige korrekt, verzerrt aber einen ENTWICKLUNGS-DELTA
-- ueber ein Fenster, in dem eine Boerse erst mittendrin dazukam (der Sprung
-- in der Summe waere dann teilweise ein Boersen-Onboarding-Artefakt, keine
-- echte OI-Bewegung). Diese Funktion liefert die Grundlage, um genau das
-- in der Anwendungsschicht zu erkennen (siehe lib/marketContext.ts /
-- lib/reportContext.ts) -- veraendert selbst keine bestehende Aggregation.
create or replace function public.get_market_snapshot_exchange_first_seen()
returns table(exchange text, first_seen timestamptz)
language sql
stable
set search_path to 'public'
as $$
  select m.exchange, min(m.timestamp_utc) as first_seen
  from market_snapshots m
  where m.status = 'ok'
  group by m.exchange;
$$;
