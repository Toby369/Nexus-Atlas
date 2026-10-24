-- Exportiert aus supabase_migrations.schema_migrations (20260828205232 create_rate_limit_events)

-- Rate-Limiting-Speicher fuer den "Jetzt ausfuehren"-Endpoint
-- (POST /api/reports/run). Vercel Serverless Functions sind zustandslos
-- zwischen Aufrufen -- ein In-Memory-Zaehler ueberlebt keinen Kaltstart und
-- wird bei mehreren gleichzeitigen Instanzen ohnehin nicht geteilt. Diese
-- Tabelle ist der gemeinsame, persistente Zaehler-Speicher, analog zum
-- bestehenden report_runs-Muster (service-role-only Schreibzugriff, keine
-- clientseitige Nutzung noetig -- daher RLS aktiv, aber bewusst OHNE jede
-- Policy, siehe report_configs/report_runs "Public read access" als
-- Gegenbeispiel: hier gibt es keinen Lesefall, der Anon-Zugriff braucht).
create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  endpoint text not null,
  created_at timestamptz not null default now()
);

-- Traegt die Fenster-Abfrage ("wie viele Events fuer diesen Endpoint seit
-- X?"), die bei jedem Aufruf laeuft.
create index if not exists rate_limit_events_endpoint_created_at_idx
  on public.rate_limit_events (endpoint, created_at desc);

alter table public.rate_limit_events enable row level security;
-- Bewusst keine Policies -- ausschliesslich ueber den Service-Role-Client
-- (lib/supabaseAdmin.ts) gelesen/geschrieben, wie bereits bei report_runs'
-- INSERT-Pfad etabliert.;
