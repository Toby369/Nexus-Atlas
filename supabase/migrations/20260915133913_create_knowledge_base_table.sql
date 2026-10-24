-- Exportiert aus supabase_migrations.schema_migrations (20260915133913 create_knowledge_base_table)

-- Wissens-Integration Welz/Salomon/Mein Trading System (Nutzer-Wunsch
-- 15.09.2026, "lernkarten anlegen ... welz und salomon integrieren").
-- Reine Referenz-Inhalte (kein Frage-Antwort-Format wie quiz_cards --
-- andere Struktur, bewusst getrennte Tabelle, siehe Umsetzungsplan).
-- Statischer Text, per Migration befuellt, keine Nutzer-Bearbeitung
-- vorgesehen -- deshalb kein eigenes API-Schreib-Route in dieser Phase.
create table public.knowledge_base (
  id bigint generated always as identity primary key,
  module text not null check (module in ('welz', 'salomon', 'mein_system')),
  section text not null,
  title text not null,
  content text not null,
  source text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.knowledge_base is 'Referenz-Wissen fuer die Wissens-Kacheln auf /lernen (Welz-Psychologie, Salomon-Chartanalyse, Mein Trading System) -- statischer Text, gepflegt per Migration, nicht per API.';

alter table public.knowledge_base enable row level security;

create policy "Public read access" on public.knowledge_base
  for select
  using (true);
