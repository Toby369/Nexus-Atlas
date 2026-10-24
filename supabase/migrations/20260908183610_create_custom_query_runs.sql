-- Exportiert aus supabase_migrations.schema_migrations (20260908183610 create_custom_query_runs)

create table public.custom_query_runs (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  prompt text not null,
  provider text,
  model text,
  answer text,
  market_data_generated_at timestamptz,
  status text not null,
  error text
);

comment on table public.custom_query_runs is
  'Freie-Anfrage-Kachel (Nutzer-Wunsch 08.09.2026): Nutzer stellt der KI eine
   frei formulierte Aufgabe/Frage, die KI antwortet ausschliesslich basierend
   auf dem echten, strukturierten Nexus-Marktkontext (siehe
   lib/customQueryContext.ts) statt erfundener Zahlen. market_data_generated_at
   haelt fest, auf welchem Datenstand die Antwort beruht (Transparenz).';

alter table public.custom_query_runs enable row level security;

create policy "Public read access"
  on public.custom_query_runs
  for select
  using (true);
