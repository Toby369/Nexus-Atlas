-- Exportiert aus supabase_migrations.schema_migrations (20260904095120 enable_rls_research_dc_events)

alter table public.research_dc_events enable row level security;

create policy research_dc_events_select_all on public.research_dc_events
  for select
  to public
  using (true);
