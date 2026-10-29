-- Exportiert aus supabase_migrations.schema_migrations (20261006152018 create_chart_narratives_table)

create table public.chart_narratives (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  provider text,
  model text,
  result jsonb,
  status text not null,
  error text
);

alter table public.chart_narratives enable row level security;

create policy "Public read access" on public.chart_narratives
  for select
  to public
  using (true);
