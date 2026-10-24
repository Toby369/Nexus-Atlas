-- Exportiert aus supabase_migrations.schema_migrations (20260913153544 create_research_funding_rate_history_table)

-- Runde-2-Korrektur: Funding-Rate-Historie fuer Funding-Z-Score. Live-Test
-- (net.http_get) bestaetigt: Binance fapi/v1/fundingRate liefert echte Daten
-- bis 2022-09-04 zurueck (kein 30-Tage-Limit wie bei openInterestHist/
-- globalLongShortAccountRatio, die mit HTTP 400 "startTime is invalid"
-- antworten, sobald man weiter als das Retention-Fenster zurueckgeht --
-- das ist der Grund, warum Net-Taker-Flow-Ratio/OI-Quadrant/Positionierung
-- NICHT rueckwirkend vertieft werden koennen, Funding-Rate aber schon).
create table research_funding_rate_history (
  funding_time timestamptz primary key,
  funding_rate numeric not null
);
