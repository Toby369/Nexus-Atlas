-- Exportiert aus supabase_migrations.schema_migrations (20260918054330 create_system_briefings_table)

create table if not exists system_briefings (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  provider text,
  model text,
  result jsonb,
  status text not null,
  error text
);
alter table system_briefings enable row level security;
create policy "Public read access" on system_briefings for select using (true);
