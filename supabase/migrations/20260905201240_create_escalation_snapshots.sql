-- Exportiert aus supabase_migrations.schema_migrations (20260905201240 create_escalation_snapshots)

create table public.escalation_snapshots (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  trigger_reasons jsonb not null,
  reads jsonb not null default '[]'::jsonb,
  failed_providers jsonb not null default '[]'::jsonb,
  consensus text check (consensus = any (array['AGREEMENT'::text, 'DIVERGENCE'::text, 'INCONCLUSIVE'::text])),
  status text not null check (status = any (array['ok'::text, 'error'::text])),
  error text
);

comment on table public.escalation_snapshots is
  'Thema KI, "gezielte Eskalation" (05.09.2026): mehrere unabhaengige AI-Provider (siehe lib/ai/tileConfig.ts ESCALATION_PROVIDER_ENSEMBLE) bewerten unabhaengig dieselbe Gesamteinschaetzung -- ausgeloest NUR wenn Signal-Engine/Divergenz-Radar/Report-Master bereits einen Widerspruch melden (siehe lib/escalationContext.ts). trigger_reasons dokumentiert, welcher bestehende Mechanismus die Eskalation ausgeloest hat; reads die einzelnen Provider-Antworten; consensus das rein regelbasierte Ergebnis (lib/escalationConsensus.ts). Nur ueber POST /api/escalation/generate geschrieben (service_role), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

alter table public.escalation_snapshots enable row level security;

create policy "Public read access" on public.escalation_snapshots
  for select to public using (true);
