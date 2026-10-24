-- Exportiert aus supabase_migrations.schema_migrations (20261017203047 create_term_basis_snapshots)

create table public.term_basis_snapshots (
  id bigserial primary key,
  timestamp_utc timestamptz not null,
  instrument text not null,
  expiry_utc timestamptz not null,
  days_to_expiry numeric not null,
  future_price numeric not null,
  index_price numeric not null,
  basis_pct numeric not null,
  basis_annualized_pct numeric not null,
  source text not null default 'deribit',
  created_at timestamptz not null default now(),
  unique (timestamp_utc, instrument)
);

comment on table public.term_basis_snapshots is
  'Termin-Basis des vordersten Deribit-Quartals-Futures (>= 30 Tage Restlaufzeit) gegen den Deribit-Index, annualisiert. Naeherung fuer die CME-Basis. source = deribit (stuendlich live) oder deribit_backfill (taeglich, Index-Naeherung ueber BTC-PERPETUAL).';

create index term_basis_snapshots_ts_idx on public.term_basis_snapshots (timestamp_utc desc);

alter table public.term_basis_snapshots enable row level security;
create policy "Public read access" on public.term_basis_snapshots for select using (true);
