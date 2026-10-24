-- Exportiert aus supabase_migrations.schema_migrations (20260824115701 create_etf_flows_table)

create table if not exists public.etf_flows (
  id bigint generated always as identity primary key,
  flow_date date not null,
  total_flow_usd_m numeric,
  source text not null default 'farside',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_etf_flows_date_source
  on public.etf_flows (flow_date, source);

create index if not exists idx_etf_flows_date
  on public.etf_flows (flow_date desc);

alter table public.etf_flows enable row level security;

create policy "Public read access" on public.etf_flows
  for select using (true);
