-- Exportiert aus supabase_migrations.schema_migrations (20260825163241 create_ai_report_engine_tables)

-- NEXUS AI Report Engine: Nutzer-Konfiguration (max. 4 Slots) + Ausfuehrungs-
-- Historie. Siehe Vorgabe Teil M-P.
--
-- report_configs: genau 4 Zeilen (slot 1-4), vom Dashboard aus editierbar.
-- provider/report_type/timeframe sind bewusst text statt enum -- neue
-- Provider (Etappe 1) oder Report-Typen sollen ohne Schema-Migration
-- nutzbar sein, die App validiert die zulaessigen Werte serverseitig gegen
-- lib/ai/providers/index.ts bzw. lib/ai/promptProfiles.ts.
create table public.report_configs (
  id bigint generated always as identity primary key,
  slot smallint not null unique check (slot between 1 and 4),
  report_type text not null check (report_type in ('market_structure', 'positioning', 'news_macro', 'master')),
  provider text not null,
  model text,
  timeframe text not null check (timeframe in ('15M', '1H', '4H', '24H', '1W', '1M')),
  schedule_time time,
  active boolean not null default false,
  email_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.report_configs is
  'Nutzer-Konfiguration der bis zu 4 AI-Report-Slots (Provider/Modell/Typ/Zeitraum/Zeitplan/E-Mail). Schreibzugriff nur ueber Server-Route mit Service-Role-Key, nie direkt vom Client mit dem Anon-Key.';

-- report_runs: jede tatsaechliche Ausfuehrung eines Reports, inkl. der
-- vollstaendigen Datenbasis (data_snapshot), damit jeder Report spaeter
-- nachvollziehbar bleibt (Vorgabe Teil P: "keine Black Box").
create table public.report_runs (
  id bigint generated always as identity primary key,
  report_config_id bigint references public.report_configs(id) on delete set null,
  report_type text not null check (report_type in ('market_structure', 'positioning', 'news_macro', 'master')),
  provider text not null,
  model text,
  timeframe text not null check (timeframe in ('15M', '1H', '4H', '24H', '1W', '1M')),
  generated_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'error')),
  result jsonb,
  data_snapshot jsonb,
  error text,
  email_sent boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.report_runs is
  'Ausfuehrungs-Historie der AI Report Engine. result = strukturierte KI-Antwort (bias/confidence/summary/...), data_snapshot = das FullMarketContext-Objekt, das der KI als Kontext diente (siehe lib/reportContext.ts) -- garantiert Nachvollziehbarkeit, welche Daten dem Report zugrunde lagen.';

create index report_runs_generated_at_idx on public.report_runs (generated_at desc);
create index report_runs_report_config_id_idx on public.report_runs (report_config_id);

alter table public.report_configs enable row level security;
alter table public.report_runs enable row level security;

-- Gleiche Konvention wie alle uebrigen Tabellen in diesem Projekt: oeffentlicher
-- Lesezugriff (Dashboard zeigt Konfiguration/Historie ohne eigenes Auth-System),
-- Schreibzugriff ausschliesslich ueber den Service-Role-Key serverseitig.
create policy "Public read access" on public.report_configs for select using (true);
create policy "Public read access" on public.report_runs for select using (true);
