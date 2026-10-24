-- Exportiert aus supabase_migrations.schema_migrations (20260904202617 add_momentum_confirmed_column)


alter table public.research_triple_barrier_context
  add column if not exists momentum_confirmed_1h boolean;
