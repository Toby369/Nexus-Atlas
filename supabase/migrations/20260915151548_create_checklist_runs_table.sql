-- Exportiert aus supabase_migrations.schema_migrations (20260915151548 create_checklist_runs_table)

-- Nutzer-Wunsch 15.09.2026 ("leichtgewichtige Snapshot-Protokollierung,
-- ja"): die drei Checklisten unter /lernen (Wissen-Tab) speicherten den
-- Haken-Zustand bisher NUR in lokalem React-State (reine Momentaufnahme,
-- weg nach Reload) -- kein Bezug zum eigentlichen Welz-Prinzip
-- "Trading-Journal-Pflicht". Diese Tabelle protokolliert bewusst NUR den
-- Snapshot beim "Fertig"-Klick (welche Punkte abgehakt waren, wie viele
-- von wie vielen), OHNE Verknuepfung zu einem konkreten Trade -- ein
-- vollwertiges Trade-Journal (Entry/Exit/Ergebnis) waere ein eigenes,
-- deutlich groesseres Feature und war nicht Teil dieser Anfrage.
create table public.checklist_runs (
  id bigint generated always as identity primary key,
  module text not null check (module in ('welz', 'salomon', 'mein_system')),
  checked_items text[] not null default '{}',
  checked_count integer not null,
  total_count integer not null,
  created_at timestamptz not null default now()
);

comment on table public.checklist_runs is 'Snapshot-Protokoll der Wissens-Checklisten auf /lernen (Welz/Salomon/Mein System) -- ein Eintrag pro "Fertig"-Klick, kein Trade-Bezug.';

create index checklist_runs_module_created_at_idx on public.checklist_runs (module, created_at desc);

alter table public.checklist_runs enable row level security;

create policy "Public read access" on public.checklist_runs
  for select
  using (true);
