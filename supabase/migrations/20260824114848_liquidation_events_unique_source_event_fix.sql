-- Exportiert aus supabase_migrations.schema_migrations (20260824114848 liquidation_events_unique_source_event_fix)

drop index if exists public.idx_liquidation_events_exchange_source_event;

-- source_event_id ist bei unserem Collector immer gesetzt, daher ein
-- normaler (nicht partieller) Unique-Index -- fuer upsert(onConflict:...)
-- via PostgREST/supabase-js muss der Index exakt (nicht partiell) sein.
create unique index if not exists idx_liquidation_events_exchange_source_event
  on public.liquidation_events (exchange, source_event_id);
