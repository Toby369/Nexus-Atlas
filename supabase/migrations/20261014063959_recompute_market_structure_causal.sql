-- Exportiert aus supabase_migrations.schema_migrations (20261014063959 recompute_market_structure_causal)

-- 2026-10-14: Kausale Neuberechnung von structure_trend/bos/choch in market_features.
-- Identische Logik wie collect-candles::computeMarketStructure (Version 18):
-- Fraktal-Swing bei Kerze j wird erst bei Kerze j+lookback verarbeitet.
-- swing_type bleibt unveraendert (Label am Pivot-Bar). Nur Zeilen mit
-- tatsaechlicher Aenderung werden geschrieben. Gibt die Anzahl geaenderter Zeilen zurueck.
create or replace function public.recompute_market_structure_causal(
  p_interval text,
  p_symbol text default 'BTCUSDT',
  p_lookback integer default 5
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  h double precision[];
  l double precision[];
  t timestamptz[];
  n integer;
  raw_high boolean[];
  raw_low boolean[];
  trend_arr text[];
  bos_arr boolean[];
  bos_dir text[];
  choch_arr boolean[];
  choch_dir text[];
  i integer;
  j integer;
  k integer;
  is_high boolean;
  is_low boolean;
  last_high double precision;
  last_low double precision;
  trend text := 'ranging';
  st text;
  changed integer;
begin
  select array_agg(c.high::double precision order by c.open_time),
         array_agg(c.low::double precision order by c.open_time),
         array_agg(c.open_time order by c.open_time)
    into h, l, t
    from candles c
   where c.exchange = 'binance' and c.symbol = p_symbol and c.interval = p_interval;
  n := coalesce(array_length(h, 1), 0);
  if n = 0 then
    return 0;
  end if;

  raw_high := array_fill(false, array[n]);
  raw_low := array_fill(false, array[n]);
  for i in (p_lookback + 1)..(n - p_lookback) loop
    is_high := true;
    is_low := true;
    for k in (i - p_lookback)..(i + p_lookback) loop
      continue when k = i;
      if h[k] >= h[i] then is_high := false; end if;
      if l[k] <= l[i] then is_low := false; end if;
    end loop;
    raw_high[i] := is_high;
    raw_low[i] := is_low;
  end loop;

  trend_arr := array_fill('ranging'::text, array[n]);
  bos_arr := array_fill(false, array[n]);
  bos_dir := array_fill(null::text, array[n]);
  choch_arr := array_fill(false, array[n]);
  choch_dir := array_fill(null::text, array[n]);

  for i in 1..n loop
    j := i - p_lookback;
    st := null;
    if j >= 1 then
      if raw_high[j] then
        if last_high is not null then
          st := case when h[j] > last_high then 'HH' else 'LH' end;
        end if;
        last_high := h[j];
      elsif raw_low[j] then
        if last_low is not null then
          st := case when l[j] > last_low then 'HL' else 'LL' end;
        end if;
        last_low := l[j];
      end if;
    end if;

    if st in ('HH', 'HL') then trend := 'bullish';
    elsif st in ('LH', 'LL') then trend := 'bearish';
    end if;

    if trend = 'bullish' then
      if last_low is not null and l[i] < last_low then
        choch_arr[i] := true; choch_dir[i] := 'bearish'; trend := 'bearish';
      elsif last_high is not null and h[i] > last_high then
        bos_arr[i] := true; bos_dir[i] := 'bullish';
      end if;
    elsif trend = 'bearish' then
      if last_high is not null and h[i] > last_high then
        choch_arr[i] := true; choch_dir[i] := 'bullish'; trend := 'bullish';
      elsif last_low is not null and l[i] < last_low then
        bos_arr[i] := true; bos_dir[i] := 'bearish';
      end if;
    end if;

    trend_arr[i] := trend;
  end loop;

  update market_features mf
     set structure_trend = x.trend,
         bos = x.bos,
         bos_direction = x.bos_direction,
         choch = x.choch,
         choch_direction = x.choch_direction
    from unnest(t, trend_arr, bos_arr, bos_dir, choch_arr, choch_dir)
         as x(open_time, trend, bos, bos_direction, choch, choch_direction)
   where mf.symbol = p_symbol
     and mf.interval = p_interval
     and mf.candle_open_time = x.open_time
     and (mf.structure_trend is distinct from x.trend
          or mf.bos is distinct from x.bos
          or mf.bos_direction is distinct from x.bos_direction
          or mf.choch is distinct from x.choch
          or mf.choch_direction is distinct from x.choch_direction);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.recompute_market_structure_causal(text, text, integer) from public, anon, authenticated;
