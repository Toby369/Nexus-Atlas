-- Exportiert aus supabase_migrations.schema_migrations (20260911183003 enable_rls_swing_setup_chain_results)

alter table research_swing_setup_chain_results enable row level security;
create policy "Public read access" on research_swing_setup_chain_results
  for select to public using (true);
