-- Exportiert aus supabase_migrations.schema_migrations (20260826193501 create_onchain_snapshots)

-- Phase 5 Market-Intelligence-Engine: On-Chain-Collector (BGeometrics/
-- bitcoin-data.com, kostenloser Tier: 10 Requests/Stunde, 15/Tag --
-- verifiziert per Live-Aufruf mit dem vom Nutzer bereitgestellten Key).
-- Gleiches generisches Zeitreihen-Zeilenformat wie macro_snapshots (metric
-- statt symbol) -- keine neue Tabellenstruktur erfunden, konsistent zum
-- bestehenden Muster.
--
-- WICHTIG (per Live-Test verifiziert, nicht angenommen): exchange-netflow-
-- btc und exchange-reserve-btc sind auf dem kostenlosen Tier NICHT
-- verfuegbar (HTTP 403 trotz Auflistung in der API-Dokumentation) --
-- deshalb bewusst NICHT im Collector, um keine taeglich fehlschlagenden
-- Anfragen gegen das knappe Rate-Limit zu verschwenden.
create table public.onchain_snapshots (
  id bigint generated always as identity primary key,
  timestamp_utc timestamptz not null,
  metric text not null,
  label text not null,
  value numeric,
  prev_value numeric,
  change_pct numeric,
  observation_date date,
  status text not null default 'ok' check (status = any (array['ok','error'])),
  error text,
  created_at timestamptz not null default now()
);

alter table public.onchain_snapshots enable row level security;

create policy "Public read access" on public.onchain_snapshots
  for select
  to public
  using (true);

comment on table public.onchain_snapshots is 'On-Chain-Kennzahlen (SOPR, MVRV, Realized Price, LTH/STH-Aktivitaet, Miner-Flows, Stablecoin-Supply) von BGeometrics/bitcoin-data.com, kostenloser Tier (10 Req/h, 15/Tag). Einmal taeglich per pg_cron erfasst -- Datengranularitaet ist ohnehin taeglich, haeufigere Erfassung waere reine Rate-Limit-Verschwendung.';
