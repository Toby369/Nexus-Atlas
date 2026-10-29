-- Exportiert aus supabase_migrations.schema_migrations (20260826131728 create_sentiment_snapshots)

create table public.sentiment_snapshots (
  id bigint generated always as identity primary key,
  timestamp_utc timestamptz not null default now(),
  source text not null default 'alternative.me',
  value smallint,
  classification text,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create index sentiment_snapshots_timestamp_idx on public.sentiment_snapshots (timestamp_utc desc);

comment on table public.sentiment_snapshots is 'Crypto Fear & Greed Index (alternative.me, free/public, no API key) -- taegliche Kennzahl, stuendlich abgefragt. Historie wird nie ueberschrieben.';
