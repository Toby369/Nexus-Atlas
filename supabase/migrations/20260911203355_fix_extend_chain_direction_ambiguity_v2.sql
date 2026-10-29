-- Exportiert aus supabase_migrations.schema_migrations (20260911203355 fix_extend_chain_direction_ambiguity_v2)


drop function if exists research_confluence_extend_chain();

create function research_confluence_extend_chain()
returns table(out_direction text, inserted_count integer)
language plpgsql
as $$
declare
  v_dir text;
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
begin
  foreach v_dir in array array['LONG','SHORT'] loop
    select coalesce(max(c.resolution_time), '2024-09-11'::timestamptz) + interval '15 minutes'
      into v_start
    from research_swing_setup_chain_results c
    where c.direction = v_dir and c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5
      and c.retrace_pct = 0.25 and c.vertical_bars = 192;

    select max(m.candle_open_time) into v_end
    from market_features m where m.symbol = 'BTCUSDT' and m.interval = '15m';

    insert into research_swing_setup_chain_results
      (interval, direction, tp_pct, sl_pct, retrace_pct, vertical_bars,
       signal_time, entry_time, entry_price, outcome, resolution_time, bars_to_resolution, mfe_pct)
    select '15m', v_dir, 1.75, 0.5, 0.25, 192,
           e.signal_time, e.entry_time, e.entry_price, e.outcome, e.resolution_time, e.bars_to_resolution, e.mfe_pct
    from research_swing_setup_chain_events('15m', v_dir, 1.75, 0.5, 0.25, 192, v_start, v_end) e;

    get diagnostics v_count = row_count;
    out_direction := v_dir;
    inserted_count := v_count;
    return next;
  end loop;
end;
$$;
