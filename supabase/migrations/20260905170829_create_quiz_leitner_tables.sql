-- Exportiert aus supabase_migrations.schema_migrations (20260905170829 create_quiz_leitner_tables)

create table public.quiz_cards (
  id bigint generated always as identity primary key,
  question text not null,
  answer text not null,
  explanation text,
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.quiz_progress (
  card_id bigint primary key references public.quiz_cards(id) on delete cascade,
  box smallint not null default 1 check (box between 1 and 4),
  due_at timestamptz not null default now(),
  last_seen_at timestamptz,
  correct_streak integer not null default 0,
  total_correct integer not null default 0,
  total_hard integer not null default 0,
  total_wrong integer not null default 0,
  history jsonb not null default '[]'::jsonb
);

comment on table public.quiz_cards is
  'Lernkarten-Feature (Leitner-Karteikasten), Konzept aus src/components/start/KachelQuiz.vue + shared/leitner.js im Crypto-Trading-Journal. Toby traegt eigene Fragen ein (z.B. zu Nexus-Faktoren, Handelsregeln). Schreibzugriff nur ueber /api/quiz/* (service_role) -- wie report_configs, nicht direkt per Anon-Key.';
comment on table public.quiz_progress is
  'Ein Fortschritt je Karte: Box (1-4), Faelligkeit, Zaehler. Siehe lib/leitner.ts fuer die Uebergangsregeln (Vergessen->Box1, Schwer->bleibt, Gut->+1, Leicht->+2).';

alter table public.quiz_cards enable row level security;
alter table public.quiz_progress enable row level security;

create policy "Public read access" on public.quiz_cards for select using (true);
create policy "Public read access" on public.quiz_progress for select using (true);
