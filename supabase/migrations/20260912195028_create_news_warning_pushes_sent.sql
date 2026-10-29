-- Exportiert aus supabase_migrations.schema_migrations (20260912195028 create_news_warning_pushes_sent)


-- 12.09.2026 -- Dedupe-Tabelle fuer die neue Wirtschaftsdaten-Vorwarnung in
-- send-state-change-push (Nutzer-Wunsch: "mich warnen weil (zeit)
-- marktdaten veroeffentlicht werden"). Ein unique(warning_id, mark_id,
-- event_date) sorgt dafuer, dass pro Termin GENAU EINMAL gepusht wird,
-- unabhaengig vom 15-Minuten-Cron-Timing (Zeitfenster-basierte Ansaetze
-- wie bei den market_states-Zustandswechseln funktionieren hier nicht,
-- weil es keine "letzten zwei Zeilen" gibt, die man vergleichen koennte --
-- Wirtschaftstermine sind einmalige Ereignisse, kein fortlaufender Strom).
create table if not exists news_warning_pushes_sent (
  id bigint generated always as identity primary key,
  warning_id text not null,
  mark_id text not null,
  event_date date not null,
  sent_at timestamptz not null default now(),
  unique (warning_id, mark_id, event_date)
);

alter table news_warning_pushes_sent enable row level security;

create policy "Public read access"
  on news_warning_pushes_sent
  for select
  using (true);
