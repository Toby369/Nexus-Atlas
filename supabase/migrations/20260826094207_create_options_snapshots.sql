-- Exportiert aus supabase_migrations.schema_migrations (20260826094207 create_options_snapshots)

create table public.options_snapshots (
  id bigint generated always as identity primary key,
  timestamp_utc timestamptz not null,
  currency text not null default 'BTC',
  near_expiry text,
  near_expiry_days numeric,
  underlying_price numeric,
  atm_iv numeric,
  skew_proxy numeric,
  put_call_oi_ratio numeric,
  max_pain_strike numeric,
  total_oi_calls_btc numeric,
  total_oi_puts_btc numeric,
  instrument_count integer,
  status text not null default 'ok' check (status in ('ok','error')),
  error text,
  created_at timestamptz not null default now()
);

create index idx_options_snapshots_lookup on public.options_snapshots (currency, timestamp_utc desc);

alter table public.options_snapshots enable row level security;
create policy "Public read access" on public.options_snapshots for select using (true);

comment on table public.options_snapshots is 'Phase 3: Deribit BTC-Optionen (oeffentliche, kostenlose API, kein Key noetig). atm_iv = durchschnittliche Mark-IV der naechstliegenden Strikes zum Spot in der naechsten Verfallsperiode. skew_proxy = IV eines ca. 10% OTM-Puts minus IV eines ca. 10% OTM-Calls derselben Verfallsperiode (Naeherung, kein echtes Delta-25-Skew, da die Book-Summary-Route keine Greeks liefert). put_call_oi_ratio = OI aller Puts / OI aller Calls, ueber alle Verfallsperioden. max_pain_strike = Strike mit minimalem Gesamt-Auszahlungsbetrag in der naechsten Verfallsperiode (Standard-Max-Pain-Berechnung).';
