-- Exportiert aus supabase_migrations.schema_migrations (20260826101455 create_market_states)

create table public.market_states (
  id bigint generated always as identity primary key,
  timestamp_utc timestamptz not null,
  overall_state text not null check (overall_state in ('BULLISH','BEARISH','NEUTRAL','MIXED','INSUFFICIENT_DATA')),
  score numeric,
  confidence numeric not null check (confidence >= 0 and confidence <= 100),
  data_coverage_pct numeric not null check (data_coverage_pct >= 0 and data_coverage_pct <= 100),
  factors jsonb not null,
  patterns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_market_states_lookup on public.market_states (timestamp_utc desc);

alter table public.market_states enable row level security;
create policy "Public read access" on public.market_states for select using (true);

comment on table public.market_states is 'Phase 6: Market-State-Engine-Ausgabe. factors = jsonb-Objekt mit jedem einzelnen Faktor (Struktur/Momentum/CVD/OI-Preis/Positioning/Options-Skew/Makro/Funding), jeweils Wert (-1/0/+1) + Rohbasis -- vollstaendig nachvollziehbar, kein Black-Box-Score. patterns = erkannte benannte Muster (z.B. "Short Squeeze"), als Interpretationshilfen, keine Handelssignale. data_coverage_pct = Anteil der 8 moeglichen Faktoren, die tatsaechlich mit frischen Daten belegt waren -- confidence beruecksichtigt sowohl Coverage als auch Einigkeit der Faktoren.';
