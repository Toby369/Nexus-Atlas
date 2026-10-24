-- Exportiert aus supabase_migrations.schema_migrations (20260818030240 add_market_snapshot_constraints)

alter table public.market_snapshots enable row level security;

create index if not exists idx_market_snapshots_created_at
  on public.market_snapshots (created_at desc);
