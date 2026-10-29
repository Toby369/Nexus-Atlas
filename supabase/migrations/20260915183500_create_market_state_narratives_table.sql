-- Exportiert aus supabase_migrations.schema_migrations (20260915183500 create_market_state_narratives_table)

-- Gesamteinschaetzung-Zusammenfassung (Nutzer-Wunsch 15.09.2026): KI-Kachel,
-- die erklaert, wie die 8 Sparten der Status-Zeile (siehe HeroHeader.tsx)
-- zueinander stehen -- Widersprueche/Zusammenhaenge und WARUM die
-- Verlaesslichkeits-Zahl so ist wie sie ist, inkl. Salomon-Phase als
-- Pruefraster. Gleiches Muster wie handelslage_snapshots/
-- signal_review_snapshots: click-triggered, kein Auto-Refresh, nur
-- zwischengespeicherter letzter Stand wird angezeigt.
create table public.market_state_narratives (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  provider text,
  model text,
  result jsonb,
  status text not null,
  error text
);

alter table public.market_state_narratives enable row level security;

create policy "Public read access" on public.market_state_narratives
  for select using (true);
