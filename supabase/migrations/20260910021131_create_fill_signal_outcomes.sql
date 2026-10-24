-- Exportiert aus supabase_migrations.schema_migrations (20260910021131 create_fill_signal_outcomes)


-- Periodischer KI-Rueckblick Phase 1: befuellt outcome_price/outcome_at/
-- return_pct/hit fuer signal_outcomes-Zeilen, deren Horizont bereits
-- abgelaufen ist (fired_at + horizon_hours <= now()). Punkt-in-Zeit-sicher
-- per Konstruktion: eine Zeile wird erst angefasst, wenn der Zielzeitpunkt
-- (fired_at + horizon_hours) in der Vergangenheit liegt, UND es wird
-- ausschliesslich die erste bereits abgeschlossene 1H-Kerze AB diesem
-- Zielzeitpunkt herangezogen (kein Blick auf spaetere/juengere Kerzen).
--
-- Symbol/Intervall fest auf Binance BTCUSDT 1H -- exakt dieselbe Quelle wie
-- SYMBOL/INTERVAL in compute-market-state UND der Ticker aller TradingView-
-- Alerts, keine neue Kalibrierung noetig.
create or replace function public.fill_signal_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filled integer;
begin
  with due as (
    select so.id, so.price_at_signal, so.direction_expected,
      so.fired_at + (so.horizon_hours || ' hours')::interval as target_time
    from public.signal_outcomes so
    where so.filled_at is null
      and so.fired_at + (so.horizon_hours || ' hours')::interval <= now()
  ),
  matched as (
    select
      d.id, d.price_at_signal, d.direction_expected,
      c.close as outcome_price,
      c.close_time as outcome_at
    from due d
    cross join lateral (
      select c.close, c.close_time
      from public.candles c
      where c.exchange = 'binance'
        and c.symbol = 'BTCUSDT'
        and c.interval = '1h'
        and c.open_time >= d.target_time
        and c.close_time <= now()
      order by c.open_time asc
      limit 1
    ) c
  )
  update public.signal_outcomes so
  set
    outcome_price = m.outcome_price,
    outcome_at = m.outcome_at,
    return_pct = ((m.outcome_price - m.price_at_signal) / m.price_at_signal) * 100,
    hit = case
      when m.direction_expected = 'bullish' then m.outcome_price > m.price_at_signal
      when m.direction_expected = 'bearish' then m.outcome_price < m.price_at_signal
      else null
    end,
    filled_at = now()
  from matched m
  where so.id = m.id;

  get diagnostics v_filled = row_count;
  return v_filled;
end;
$$;

comment on function public.fill_signal_outcomes is
  'Periodischer KI-Rueckblick Phase 1 (09.09.2026): befuellt reife signal_outcomes-Zeilen (Horizont abgelaufen) mit dem tatsaechlichen Preis-Ausgang aus candles (Binance BTCUSDT 1H) -- punkt-in-Zeit-sicher, nur bereits abgeschlossene Kerzen ab dem Zielzeitpunkt. hit ist NULL, wenn direction_expected NULL ist (richtungslose Risk-Faktoren -- dort ist nur return_pct/Magnitude auswertbar).';

select cron.schedule(
  'detect-signal-outcomes-every-15-min',
  '*/15 * * * *',
  $cron$
    select public.detect_tradingview_signal_outcomes();
    select public.detect_warning_pattern_outcomes();
    select public.detect_risk_factor_outcomes();
  $cron$
);

select cron.schedule(
  'fill-signal-outcomes-every-15-min',
  '5-59/15 * * * *',
  $cron$select public.fill_signal_outcomes();$cron$
);
