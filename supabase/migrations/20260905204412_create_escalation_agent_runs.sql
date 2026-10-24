-- Exportiert aus supabase_migrations.schema_migrations (20260905204412 create_escalation_agent_runs)

create table public.escalation_agent_runs (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  trigger_reasons jsonb not null,
  model text,
  result jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  status text not null check (status = any (array['ok'::text, 'error'::text])),
  error text
);

comment on table public.escalation_agent_runs is
  'Thema KI, "Eskalations-Agent" (05.09.2026): ergaenzt die statische 3-Provider-Konsensauswertung (escalation_snapshots) um EINEN echten Agenten (Anthropic, Websuche + eigenes get_market_state_history-Tool in einer begrenzten Tool-Use-Schleife, siehe lib/ai/escalationAgent.ts) -- ausgeloest ueber denselben Trigger-Mechanismus (Signal-Engine/Divergenz-Radar/Report-Master), aber als separater, teurerer, explizit angestossener Schritt. tool_calls dokumentiert Transparenz-halber, welche Tools mit welchem Input tatsaechlich aufgerufen wurden. Nur ueber POST /api/escalation/agent geschrieben (service_role), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

alter table public.escalation_agent_runs enable row level security;

create policy "Public read access" on public.escalation_agent_runs
  for select to public using (true);
