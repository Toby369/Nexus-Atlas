-- Exportiert aus supabase_migrations.schema_migrations (20261012154226 add_regime_change_pushes_sent)

-- Dedupe fuer Regime-Wechsel-Pushes (send-state-change-push, Abschnitt 5).
-- Eine Zeile je (Zeitrahmen, Kerze): verhindert, dass derselbe Wechsel bei
-- jedem 15-Min-Lauf erneut gepusht wird, solange die Kerze die neueste ist.
create table if not exists public.regime_change_pushes_sent (
  interval text not null,
  candle_time timestamptz not null,
  regime text not null,
  sent_at timestamptz not null default now(),
  primary key (interval, candle_time)
);
alter table public.regime_change_pushes_sent enable row level security;

-- Bereits gepushte 1h-Wechsel (14:00 UTC) nicht nochmals senden.
insert into public.regime_change_pushes_sent (interval, candle_time, regime)
select '1h', timestamp_utc, regime from public.market_state_matrix
where symbol = 'BTCUSDT' and interval = '1h'
order by timestamp_utc desc limit 1
on conflict do nothing;
