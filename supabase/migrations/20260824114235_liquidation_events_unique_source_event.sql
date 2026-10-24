-- Exportiert aus supabase_migrations.schema_migrations (20260824114235 liquidation_events_unique_source_event)

create unique index if not exists idx_liquidation_events_exchange_source_event
  on public.liquidation_events (exchange, source_event_id)
  where source_event_id is not null;
