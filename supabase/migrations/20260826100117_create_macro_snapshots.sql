-- Exportiert aus supabase_migrations.schema_migrations (20260826100117 create_macro_snapshots)

create table public.macro_snapshots (
  id bigint generated always as identity primary key,
  timestamp_utc timestamptz not null,
  symbol text not null,
  label text not null,
  last_price numeric,
  prev_close numeric,
  change_pct numeric,
  market_time_utc timestamptz,
  status text not null default 'ok' check (status in ('ok','error')),
  error text,
  created_at timestamptz not null default now()
);

create index idx_macro_snapshots_lookup on public.macro_snapshots (symbol, timestamp_utc desc);

alter table public.macro_snapshots enable row level security;
create policy "Public read access" on public.macro_snapshots for select using (true);

comment on table public.macro_snapshots is 'Phase 4: Makro-Referenzwerte (S&P 500, Nasdaq Composite, VIX, US-Dollar-Index, 10J-US-Treasury-Yield) ueber die oeffentliche, aber INOFFIZIELLE Yahoo-Finance-Chart-Route (query1.finance.yahoo.com/v8/finance/chart) -- kein API-Key noetig, aber nicht formal dokumentiert/garantiert (kann sich ohne Ankuendigung aendern). change_pct = Veraenderung ggue. dem letzten Handelsschluss (chartPreviousClose), NICHT ggue. der letzten Erfassung -- Aktienmaerkte sind ausserhalb der NYSE-Handelszeiten geschlossen, der Wert bleibt dann bewusst eingefroren statt eine falsche Bewegung zu suggerieren.';
