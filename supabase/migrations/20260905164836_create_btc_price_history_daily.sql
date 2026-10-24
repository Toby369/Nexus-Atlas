-- Exportiert aus supabase_migrations.schema_migrations (20260905164836 create_btc_price_history_daily)

create table public.btc_price_history_daily (
  date date primary key,
  close_price_usd numeric not null,
  source text not null default 'coingecko',
  updated_at timestamptz not null default now()
);

comment on table public.btc_price_history_daily is
  'Umsetzungsplan Phase 5 (05.09.2026): volle taegliche BTC/USD-Schlusskurs-Historie (CoinGecko, oeffentlich) fuer den Rainbow-Chart -- die candles-Tabelle deckt nur ~2 Jahre seit dem Binance-Backfill, fuer eine log-Regression ueber den vollen Marktzyklus reicht das nicht. Befuellt/aktualisiert von collect-btc-price-history-daily (Cron), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

alter table public.btc_price_history_daily enable row level security;

create policy "Public read access" on public.btc_price_history_daily
  for select using (true);
