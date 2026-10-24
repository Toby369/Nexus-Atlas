-- Exportiert aus supabase_migrations.schema_migrations (20260913151515 create_regime_refresh_cci_roc_1h_function)

-- Haelt research_regime_cci_roc_1h (Runde 6) aktuell -- ohne periodisches
-- Neuberechnen wuerden neue Bewertungspunkte (nach dem letzten Lauf) beim
-- Asof-Join in research_regime_extend_activation_round6() ins Leere laufen
-- und stillschweigend als "inaktiv" gewertet werden (identische Fehlerklasse
-- wie die Runde-4-Datenluecke, siehe PHASE1-RESULTS-Dokument). Einfachster
-- robuster Fix: komplett neu berechnen statt inkrementell fortschreiben --
-- bei ~35k 1h-Kerzen unkritisch schnell (Sekunden), kein Grund fuer
-- fehleranfaellige Teilupdates.
create or replace function public.research_regime_refresh_cci_roc_1h()
returns void
language plpgsql
as $function$
begin
  truncate table research_regime_cci_roc_1h;

  insert into research_regime_cci_roc_1h (candle_open_time, cci, roc)
  with tp as (
    select open_time, close,
      (high + low + close) / 3.0 as typical_price,
      row_number() over (order by open_time) as rn
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h'
  ),
  sma as (
    select open_time, close, typical_price, rn,
      avg(typical_price) over (order by open_time rows between 19 preceding and current row) as sma20,
      count(*) over (order by open_time rows between 19 preceding and current row) as cnt20,
      lag(close, 14) over (order by open_time) as close_14_ago
    from tp
  )
  select
    s.open_time,
    case when s.cnt20 = 20 and md.mean_dev > 0 then (s.typical_price - s.sma20) / (0.015 * md.mean_dev) else null end,
    case when s.close_14_ago is not null and s.close_14_ago <> 0 then (s.close - s.close_14_ago) / s.close_14_ago * 100 else null end
  from sma s
  cross join lateral (
    select avg(abs(sub.typical_price - s.sma20)) as mean_dev
    from (
      select t2.typical_price
      from tp t2
      where t2.rn <= s.rn and t2.rn > s.rn - 20
    ) sub
  ) md;
end;
$function$;
