-- Exportiert aus supabase_migrations.schema_migrations (20260830132048 add_tradingview_signals_table)

-- Phase 2 TradingView-Integration (Feasibility-Review vom 29.08.2026):
-- speichert externe Pine-Script-Alerts von TradingView Pro, empfangen ueber
-- die neue Edge Function webhook-tradingview. Bewusst eine eigene, davon
-- unabhaengige Tabelle -- das Signal fliesst NICHT in compute-market-state
-- (14-Faktoren-Engine) ein, um die eingefrorene Backtest-Ground-Truth nicht
-- zu veraendern (siehe PHASE-0-RECONCILIATION.md Abschnitt 17). Dient
-- ausschliesslich als eigenstaendiges, informatives Kontext-Badge im
-- Dashboard (analog zu den bestehenden Patterns wie "Short Squeeze").
create table public.tradingview_signals (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  ticker text not null,
  signal_type text not null,
  timeframe text,
  payload jsonb not null
);

alter table public.tradingview_signals enable row level security;

-- Lesezugriff oeffentlich (wie alle anderen Marktdaten-Tabellen) -- Schreiben
-- ausschliesslich ueber die Edge Function mit dem Service-Role-Client, der
-- RLS ohnehin umgeht. Keine Insert-Policy fuer anon/authenticated noetig.
create policy "Public read access" on public.tradingview_signals
  for select
  to anon, authenticated
  using (true);

grant select on public.tradingview_signals to anon, authenticated;

-- Fuer den "letztes Signal der letzten 24h"-Lookup in Schritt 2.
create index tradingview_signals_received_at_idx on public.tradingview_signals (received_at desc);
