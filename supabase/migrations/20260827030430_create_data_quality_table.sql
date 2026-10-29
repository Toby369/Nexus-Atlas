-- Exportiert aus supabase_migrations.schema_migrations (20260827030430 create_data_quality_table)

-- Phase 2 (Intelligence Validation & Backtesting Phase): Data-Quality-Layer.
--
-- Aktueller-Zustand-Tabelle (EIN Zeile pro source/metric/symbol, upserted),
-- KEIN Historien-Log -- Backtesting/History ist ausdruecklich nicht Teil
-- dieser Phase. quality_score misst AUSSCHLIESSLICH die Qualitaet der
-- zugrunde liegenden Daten (Frische/Zuverlaessigkeit/Vollstaendigkeit) und
-- ist bewusst unabhaengig von Market-State-Confidence -- beide werden nie
-- gegenseitig referenziert.
create table public.data_quality (
  id bigint generated always as identity primary key,
  source text not null,
  metric text not null,
  symbol text,
  last_success_at timestamptz,
  data_timestamp timestamptz,
  expected_update_interval_seconds integer not null,
  status text not null check (status = any (array['LIVE','VALIDATED','DEGRADED','STALE','ERROR','UNKNOWN'])),
  request_status text,
  missing_value_rate numeric check (missing_value_rate is null or (missing_value_rate >= 0 and missing_value_rate <= 1)),
  validation_status text check (validation_status = any (array['passed','failed','not_applicable'])),
  historical_observation_count integer,
  error_count integer not null default 0,
  fallback_source text,
  quality_score numeric(5,2) check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  updated_at timestamptz not null default now(),
  unique (source, metric, symbol)
);

alter table public.data_quality enable row level security;

create policy "Public read access" on public.data_quality
  for select
  to public
  using (true);

comment on table public.data_quality is 'Data-Quality-Layer (Intelligence Validation Phase 2): aktueller Qualitaetszustand je Datenquelle/Metrik/Symbol, berechnet von refresh_data_quality() durch Inspektion der bestehenden Rohdaten-Tabellen -- KEINE Aenderung an den 15 aktiven Collector-Functions noetig. age_seconds wird zur Abfragezeit aus data_timestamp berechnet (nicht gespeichert, da sich staendig aendert).';
comment on column public.data_quality.quality_score is 'Ausschliesslich Datenqualitaet (Frische 0-50 + Zuverlaessigkeit 0-30 + Vollstaendigkeit 0-20), 0-100. NICHT identisch mit Market-State-Confidence -- strukturell komplett getrennt berechnet, keine gegenseitige Referenz.';
comment on column public.data_quality.fallback_source is 'Name einer Ausweich-Quelle, falls konfiguriert. Aktuell ueberall NULL -- es existiert noch keine einzige implementierte Fallback-Kette im System (Audit-Befund), das Feld ist bewusst schon vorbereitet.';
