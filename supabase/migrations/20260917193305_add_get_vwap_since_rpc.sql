-- Exportiert aus supabase_migrations.schema_migrations (20260917193305 add_get_vwap_since_rpc)

-- Umsetzungsplan "Exakte Faktoren" Phase 2 (VWAP-Vector): generische
-- Ergaenzung zu get_anchored_vwap_summary() (die bereits weekly/monthly/
-- swing-VWAP liefert) fuer beliebige Anker-Zeitpunkte -- Tag-Anker (UTC-
-- Mitternacht) und die zwei separaten Swing-Hoch-/Swing-Tief-Anker, die
-- get_anchored_vwap_summary() nicht abdeckt (dort nur EIN gemischter
-- Swing-Anker, unabhaengig von Hoch/Tief). Mirrort exakt dieselbe VWAP-
-- Arithmetik wie die weekly_candles/monthly_candles-CTEs dort, nur
-- parametrisiert statt mit drei hart codierten Ankern.
create or replace function public.get_vwap_since(p_anchor_utc timestamptz)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select sum((high + low + close) / 3.0 * volume) / nullif(sum(volume), 0)
  from candles
  where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h'
    and open_time >= p_anchor_utc;
$$;
