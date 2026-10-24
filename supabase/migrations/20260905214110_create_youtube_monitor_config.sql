-- Exportiert aus supabase_migrations.schema_migrations (20260905214110 create_youtube_monitor_config)

create table public.youtube_monitor_config (
  id bigint primary key default 1,
  search_query text not null default 'Bitcoin BTC',
  channels jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint youtube_monitor_config_singleton check (id = 1)
);

insert into public.youtube_monitor_config (id, search_query, channels) values (1, 'Bitcoin BTC', '[]'::jsonb);

comment on table public.youtube_monitor_config is
  'Krypto-YouTube-Monitor (05.09.2026): Nutzer-konfigurierbare Suchbegriffe + Kanal-Liste (Nutzer-Wunsch "kann ich hinterlegen was angesehen werden soll"). Singleton-Zeile (id=1, per Constraint erzwungen) -- kein Multi-User-System vorhanden. Nur ueber POST /api/youtube-monitor/config geschrieben (service_role), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

alter table public.youtube_monitor_config enable row level security;

create policy "Public read access" on public.youtube_monitor_config
  for select to public using (true);
