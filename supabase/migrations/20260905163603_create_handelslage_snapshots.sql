-- Exportiert aus supabase_migrations.schema_migrations (20260905163603 create_handelslage_snapshots)

create table public.handelslage_snapshots (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  provider text,
  model text,
  bewegungsvorrat_pct numeric,
  result jsonb,
  status text not null check (status in ('ok', 'error')),
  error text
);

comment on table public.handelslage_snapshots is
  'Umsetzungsplan Phase 3 (05.09.2026): kurze, guenstige KI-Kachel "was halten die naechsten Stunden bereit", Konzept aus server/handelslage.js im Crypto-Trading-Journal. bewegungsvorrat_pct = heutige Tagesspanne / Median der letzten 10 Tage * 100. Nur ueber POST /api/handelslage/generate geschrieben (service_role), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

alter table public.handelslage_snapshots enable row level security;

create policy "Public read access" on public.handelslage_snapshots
  for select using (true);
