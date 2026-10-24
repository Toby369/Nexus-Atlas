-- Exportiert aus supabase_migrations.schema_migrations (20260914062819 add_research_rsi_reversal_backtest_function)

-- RSI-Ueberkauft/-verkauft + Gegenbewegung -> Triple-Barrier-Backtest von
-- Tobys realem Setup (14.09.2026 Recherche, siehe TRIPLE-BARRIER-MTF-
-- ALIGNMENT_2026-09-04.md fuer die identische Setup-Umrechnung: 20x Hebel,
-- SL 10%/TP 30% Margin = SL -0.5%/TP +1.5% Kursbewegung, 3:1 CRV).
--
-- Zwei unabhaengige Signal-Definitionen (Nutzer-Entscheidung: "teste
-- reversal und n kerzen gegenrichtung, separat"):
--   'pattern'   -- RSI in Extremzone UND research_detect_candlestick_
--                  patterns() erkennt am selben Balken ein Reversal-Muster
--                  in Gegenrichtung (ueberkauft+BEARISH -> Short,
--                  ueberverkauft+BULLISH -> Long)
--   'n_confirm' -- RSI erreicht die Extremzone (erster Eintritt, kein
--                  Re-Trigger solange sie gehalten wird), danach
--                  p_n_confirm aufeinanderfolgende Kerzen in Gegenrichtung
--                  als Bestaetigung
--
-- RSI(14) wird HIER selbst berechnet (identische Wilder-Formel wie
-- collect-candles/index.ts::computeRsi), fuer alle drei Timeframes (5m/15m/
-- 1h) einheitlich aus candles -- bewusst NICHT market_features.rsi_14
-- gemischt mit einer Eigenberechnung fuer 5m, um eine einzige konsistente
-- Berechnungsquelle ueber alle Timeframes zu haben.
--
-- Statistik-Rahmen identisch zur bisherigen Session-Methodik: Splits
-- train (<2026-01-14) / validation (2026-01-14..<2026-05-14) / test
-- (>=2026-05-15), Purging (Signal ausgeschlossen, wenn sein 48h-
-- Ausgang-Fenster ueber die naechste Split-Grenze hinaus reicht) + der
-- bereits im Split-Datum eingebaute 1-Tag-Embargo zwischen Validation und
-- Test. Trades, deren 48h-Fenster ueber das Ende der verfuegbaren Historie
-- hinausreicht, werden verworfen (kein rechtszensierter Ausgang).
create or replace function public.research_rsi_reversal_backtest(
  p_interval text,
  p_rsi_upper numeric,
  p_rsi_lower numeric,
  p_definition text,          -- 'pattern' | 'n_confirm'
  p_n_confirm int default 2,
  p_tp_pct numeric default 0.015,
  p_sl_pct numeric default 0.005,
  p_max_hours numeric default 48,
  p_train_end timestamptz default '2026-01-14T00:00:00Z',
  p_val_end timestamptz default '2026-05-14T00:00:00Z',
  p_test_start timestamptz default '2026-05-15T00:00:00Z'
)
returns table(
  split text,
  direction text,
  n_signals int,
  n_tp int,
  n_sl int,
  n_timeout int
)
language plpgsql
as $$
declare
  rsi_period constant int := 14;
  n int := 0;
  i int;
  j int;
  k int;
  bars_time timestamptz[];
  bars_open numeric[];
  bars_high numeric[];
  bars_low numeric[];
  bars_close numeric[];
  bars_rsi numeric[];
  pat_dir text[];
  avg_gain numeric;
  avg_loss numeric;
  diff numeric;
  data_end timestamptz;
  entry_idx int;
  entry_time timestamptz;
  entry_price numeric;
  tp_price numeric;
  sl_price numeric;
  deadline timestamptz;
  dir text;
  outcome text;
  hit_sl boolean;
  hit_tp boolean;
  confirmed boolean;
  sig_split text;
  rec record;
  cnt_n int[3][2] := array_fill(0, array[3,2]);
  cnt_tp int[3][2] := array_fill(0, array[3,2]);
  cnt_sl int[3][2] := array_fill(0, array[3,2]);
  cnt_to int[3][2] := array_fill(0, array[3,2]);
  split_idx int;
  dir_idx int;
begin
  create temp table tmp_bars(idx int primary key, open_time timestamptz) on commit drop;

  i := 0;
  for rec in
    select open_time, open, high, low, close
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = p_interval
    order by open_time asc
  loop
    i := i + 1;
    bars_time[i] := rec.open_time;
    bars_open[i] := rec.open;
    bars_high[i] := rec.high;
    bars_low[i]  := rec.low;
    bars_close[i] := rec.close;
    insert into tmp_bars values (i, rec.open_time);
  end loop;
  n := i;
  if n <= rsi_period + 2 then
    return;
  end if;
  data_end := bars_time[n];

  bars_rsi := array_fill(null::numeric, array[n]);
  avg_gain := 0; avg_loss := 0;
  for i in 2..(rsi_period+1) loop
    diff := bars_close[i] - bars_close[i-1];
    if diff >= 0 then avg_gain := avg_gain + diff; else avg_loss := avg_loss - diff; end if;
  end loop;
  avg_gain := avg_gain / rsi_period;
  avg_loss := avg_loss / rsi_period;
  bars_rsi[rsi_period+1] := case when avg_loss = 0 then 100 else 100 - 100/(1+avg_gain/avg_loss) end;
  for i in (rsi_period+2)..n loop
    diff := bars_close[i] - bars_close[i-1];
    if diff > 0 then
      avg_gain := (avg_gain*(rsi_period-1) + diff) / rsi_period;
      avg_loss := (avg_loss*(rsi_period-1)) / rsi_period;
    else
      avg_gain := (avg_gain*(rsi_period-1)) / rsi_period;
      avg_loss := (avg_loss*(rsi_period-1) + (-diff)) / rsi_period;
    end if;
    bars_rsi[i] := case when avg_loss = 0 then 100 else 100 - 100/(1+avg_gain/avg_loss) end;
  end loop;

  if p_definition = 'pattern' then
    pat_dir := array_fill(null::text, array[n]);
    for rec in
      select tb.idx, p.direction_expected
      from public.research_detect_candlestick_patterns(p_interval) p
      join tmp_bars tb on tb.open_time = p.candle_open_time
    loop
      pat_dir[rec.idx] := rec.direction_expected;
    end loop;
  end if;

  i := rsi_period + 1;
  while i <= n loop
    dir := null;
    entry_idx := null;

    if p_definition = 'pattern' then
      if bars_rsi[i] is not null then
        if bars_rsi[i] >= p_rsi_upper and pat_dir[i] = 'BEARISH' then
          dir := 'SHORT'; entry_idx := i + 1;
        elsif bars_rsi[i] <= p_rsi_lower and pat_dir[i] = 'BULLISH' then
          dir := 'LONG'; entry_idx := i + 1;
        end if;
      end if;
    else
      if bars_rsi[i] is not null and bars_rsi[i-1] is not null then
        if bars_rsi[i] >= p_rsi_upper and bars_rsi[i-1] < p_rsi_upper and i + p_n_confirm <= n then
          confirmed := true;
          for k in 1..p_n_confirm loop
            if bars_close[i+k] >= bars_close[i+k-1] then confirmed := false; end if;
          end loop;
          if confirmed then dir := 'SHORT'; entry_idx := i + p_n_confirm + 1; end if;
        elsif bars_rsi[i] <= p_rsi_lower and bars_rsi[i-1] > p_rsi_lower and i + p_n_confirm <= n then
          confirmed := true;
          for k in 1..p_n_confirm loop
            if bars_close[i+k] <= bars_close[i+k-1] then confirmed := false; end if;
          end loop;
          if confirmed then dir := 'LONG'; entry_idx := i + p_n_confirm + 1; end if;
        end if;
      end if;
    end if;

    if dir is not null and entry_idx is not null and entry_idx <= n then
      entry_time := bars_time[entry_idx];
      entry_price := bars_open[entry_idx];
      deadline := entry_time + make_interval(hours => p_max_hours);

      if deadline <= data_end then
        if dir = 'LONG' then
          tp_price := entry_price * (1 + p_tp_pct);
          sl_price := entry_price * (1 - p_sl_pct);
        else
          tp_price := entry_price * (1 - p_tp_pct);
          sl_price := entry_price * (1 + p_sl_pct);
        end if;

        outcome := 'TIMEOUT';
        j := entry_idx;
        while j <= n and bars_time[j] <= deadline loop
          if dir = 'LONG' then
            hit_sl := bars_low[j] <= sl_price;
            hit_tp := bars_high[j] >= tp_price;
          else
            hit_sl := bars_high[j] >= sl_price;
            hit_tp := bars_low[j] <= tp_price;
          end if;
          if hit_sl then outcome := 'SL'; exit; end if;
          if hit_tp then outcome := 'TP'; exit; end if;
          j := j + 1;
        end loop;

        sig_split := null;
        if entry_time < p_train_end and (entry_time + make_interval(hours => p_max_hours)) <= p_train_end then
          sig_split := 'train';
        elsif entry_time >= p_train_end and entry_time < p_val_end
              and (entry_time + make_interval(hours => p_max_hours)) <= p_test_start then
          sig_split := 'validation';
        elsif entry_time >= p_test_start then
          sig_split := 'test';
        end if;

        if sig_split is not null then
          split_idx := case sig_split when 'train' then 1 when 'validation' then 2 else 3 end;
          dir_idx := case dir when 'LONG' then 1 else 2 end;
          cnt_n[split_idx][dir_idx] := cnt_n[split_idx][dir_idx] + 1;
          if outcome = 'TP' then cnt_tp[split_idx][dir_idx] := cnt_tp[split_idx][dir_idx] + 1;
          elsif outcome = 'SL' then cnt_sl[split_idx][dir_idx] := cnt_sl[split_idx][dir_idx] + 1;
          else cnt_to[split_idx][dir_idx] := cnt_to[split_idx][dir_idx] + 1;
          end if;
        end if;
      end if;
    end if;

    i := i + 1;
  end loop;

  for split_idx in 1..3 loop
    for dir_idx in 1..2 loop
      split := case split_idx when 1 then 'train' when 2 then 'validation' else 'test' end;
      direction := case dir_idx when 1 then 'LONG' else 'SHORT' end;
      n_signals := cnt_n[split_idx][dir_idx];
      n_tp := cnt_tp[split_idx][dir_idx];
      n_sl := cnt_sl[split_idx][dir_idx];
      n_timeout := cnt_to[split_idx][dir_idx];
      return next;
    end loop;
  end loop;
end;
$$;
