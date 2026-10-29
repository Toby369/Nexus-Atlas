-- Exportiert aus supabase_migrations.schema_migrations (20260904041625 add_push_subscriptions_table)

-- Web-Push-Subscriptions (Browser-PushSubscription-Objekte). Single-User-App
-- (siehe report_configs), daher keine user_id-Spalte -- Schreibzugriff
-- ausschliesslich serverseitig ueber den Service-Role-Client (Next.js
-- API-Routen unter app/api/push/*), keine Client-Policies noetig.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
-- Bewusst keine Policies: RLS aktiv, aber ohne Policy = keine Zeile fuer
-- anon/authenticated sichtbar/schreibbar, nur der Service-Role-Client (RLS
-- bypass) kann zugreifen -- identisches Muster wie report_configs' fehlende
-- INSERT/UPDATE/DELETE-Policies.;
