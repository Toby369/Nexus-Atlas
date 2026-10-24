-- Exportiert aus supabase_migrations.schema_migrations (20260905194949 create_signal_engine_snapshots)

create table public.signal_engine_snapshots (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  provider text,
  model text,
  result jsonb,
  status text not null check (status = any (array['ok'::text, 'error'::text])),
  error text
);

comment on table public.signal_engine_snapshots is
  'Thema KI, Punkt 2/2 (05.09.2026): KI-Konsistenzpruefung der bestehenden regelbasierten Gesamteinschaetzung (14-Faktoren-Engine, market_states) -- kein eigener Bias, ein zweites Paar Augen auf deren eigene Ausgabe. Primaerer Provider Anthropic (Fallback DeepSeek, siehe lib/ai/tileConfig.ts). Nur ueber POST /api/signal-engine/generate geschrieben (service_role), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

alter table public.signal_engine_snapshots enable row level security;

create policy "Public read access" on public.signal_engine_snapshots
  for select to public using (true);
