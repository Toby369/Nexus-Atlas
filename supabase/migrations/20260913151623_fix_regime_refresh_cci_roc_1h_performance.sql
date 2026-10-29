-- Exportiert aus supabase_migrations.schema_migrations (20260913151623 fix_regime_refresh_cci_roc_1h_performance)

-- Ersetzt die erste Version: die rn-Bereichs-Lateral-Join-Variante ohne
-- Index war beim manuellen Testlauf bereits einmal in einen 60s-Timeout
-- gelaufen (vermutlich O(n^2), da die "tp"-CTE ohne MATERIALIZED pro
-- Lateral-Aufruf neu ausgewertet werden kann). Stattdessen: echte Temp-
-- Tabellen mit btree-Index auf open_time + ORDER BY/LIMIT-Rueckwaertsscan
-- (indiziert, O(n log n) gesamt) -- exakt der Ansatz, der beim initialen
-- Backfill in diesem Research-Schritt nachweislich schnell lief.
create or replace function public.research_regime_refresh_cci_roc_1h()
returns void
language plpgsql
as $function$
begin
  drop table if exists tmp_cci_candles_1h;
  drop table if exists tmp_cci_sma;

  create temp table tmp_cci_candles_1h on commit drop as
  select open_time, close, (high + low + close) / 3.0 as typical_price
  from candles
  where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h';

  create index on tmp_cci_candles_1h (open_time);

  create temp table tmp_cci_sma on commit drop as
  select open_time, close, typical_price,
    avg(typical_price) over (order by open_time rows between 19 preceding and current row) as sma20,
    count(*) over (order by open_time rows between 19 preceding and current row) as cnt20,
    lag(close, 14) over (order by open_time) as close_14_ago
  from tmp_cci_candles_1h;

  create index on tmp_cci_sma (open_time);

  truncate table research_regime_cci_roc_1h;

  insert into research_regime_cci_roc_1h (candle_open_time, cci, roc)
  select
    s.open_time,
    case when s.cnt20 = 20 and md.mean_dev > 0 then (s.typical_price - s.sma20) / (0.015 * md.mean_dev) else null end,
    case when s.close_14_ago is not null and s.close_14_ago <> 0 then (s.close - s.close_14_ago) / s.close_14_ago * 100 else null end
  from tmp_cci_sma s
  cross join lateral (
    select avg(abs(sub.typical_price - s.sma20)) as mean_dev
    from (
      select typical_price
      from tmp_cci_candles_1h c
      where c.open_time <= s.open_time
      order by c.open_time desc
      limit 20
    ) sub
  ) md;
end;
$function$;
