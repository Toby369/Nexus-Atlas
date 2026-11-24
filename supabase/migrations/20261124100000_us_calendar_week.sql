-- US-Wochenkalender (Toby 24.11.2026): Termine der laufenden Woche mit Prognose
-- und Vorherig, aus dem oeffentlichen ForexFactory-Feed (ff_calendar_thisweek.json).
-- Gefuellt taeglich von collect-economic-calendar. Gespeichert werden nur
-- US-Termine (Waehrung USD) mit Relevanz High/Medium. "Aktuell" liefert der Feed
-- nicht; Ergebnisse bleiben bei economic_event_results (News-Einordnung).
--
-- Wachstum: ca. 10-15 Zeilen pro Woche (< 1 MB pro Jahr). Aufbewahrung: die
-- Edge Function loescht Termine aelter als 60 Tage bei jedem Lauf selbst,
-- darum kein eigener pg_cron-Job (kein zusaetzliches Log-Volumen).
create table if not exists public.us_calendar_week (
  event_time timestamptz not null,
  title text not null,
  impact text not null check (impact in ('High', 'Medium')),
  forecast text,
  previous text,
  updated_at timestamptz not null default now(),
  primary key (event_time, title)
);

alter table public.us_calendar_week enable row level security;
create policy "Public read access" on public.us_calendar_week for select using (true);

-- Bis 30.10. vergab Supabase automatisch alle Rechte; ab dann keine. Beides
-- abdecken: erst alles weg, dann nur das Noetige.
revoke all on public.us_calendar_week from anon, authenticated;
grant select on public.us_calendar_week to anon, authenticated;
grant select, insert, update, delete on public.us_calendar_week to service_role;
