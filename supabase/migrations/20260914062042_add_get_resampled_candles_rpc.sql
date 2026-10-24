-- Exportiert aus supabase_migrations.schema_migrations (20260914062042 add_get_resampled_candles_rpc)

-- Read-only Resampling-RPC fuer Recherche (RSI-Gegenbewegung ueber 5m/15m/1h,
-- 14.09.2026): 5m existiert nirgends als eigenes candles/market_features-
-- Intervall und muss aus 1m aggregiert werden. Aggregation serverseitig
-- statt ~1 Mio. 1m-Zeilen einzeln zu uebertragen -- date_bin liefert exakt
-- ausgerichtete, feste Zeit-Buckets (kein Drift durch variable Kerzenzahl
-- pro Tag). Rein lesend, keine neue Tabelle, gleiche "fixe RPC statt
-- duplizierter Logik"-Konvention wie get_market_series.
create or replace function public.get_resampled_candles(
  p_symbol text,
  p_source_interval text,
  p_bucket_minutes int,
  p_since timestamptz,
  p_until timestamptz
)
returns table (
  bucket_open timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric
)
language sql
stable
as $$
  select
    date_bin(make_interval(mins => p_bucket_minutes), c.open_time, timestamptz '2000-01-01') as bucket_open,
    (array_agg(c.open order by c.open_time asc))[1] as open,
    max(c.high) as high,
    min(c.low) as low,
    (array_agg(c.close order by c.open_time desc))[1] as close,
    sum(c.volume) as volume
  from candles c
  where c.exchange = 'binance'
    and c.symbol = p_symbol
    and c.interval = p_source_interval
    and c.open_time >= p_since
    and c.open_time < p_until
  group by 1
  order by 1;
$$;

grant execute on function public.get_resampled_candles(text, text, int, timestamptz, timestamptz) to anon, authenticated;
