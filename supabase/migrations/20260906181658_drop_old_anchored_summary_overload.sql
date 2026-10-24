-- Exportiert aus supabase_migrations.schema_migrations (20260906181658 drop_old_anchored_summary_overload)

drop function if exists public.get_anchored_summary(timestamptz);
