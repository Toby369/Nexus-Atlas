-- Exportiert aus supabase_migrations.schema_migrations (20260904092941 fix_directional_change_scanner_array_append)

CREATE OR REPLACE FUNCTION public.research_directional_change_events(
  p_interval text,
  p_target_usd numeric,
  p_floor_pct numeric,
  p_floor_mode text
)
RETURNS TABLE (
  event_id integer,
  direction text,
  entry_time timestamptz,
  entry_price numeric,
  confirm_time timestamptz,
  confirm_price numeric,
  net_move_usd numeric,
  duration_hours numeric
)
LANGUAGE plpgsql
STABLE
AS $function$
declare
  rec record;
  v_mode text := 'seeking_up';
  v_anchor_time timestamptz;
  v_anchor_price numeric;
  v_ext_time timestamptz;
  v_ext_price numeric;
  v_floor numeric;
  v_floor_breached boolean;
  v_target_hit boolean;
  v_event_id integer := 0;
  v_first boolean := true;
  a_event_id integer[] := '{}';
  a_direction text[] := '{}';
  a_entry_time timestamptz[] := '{}';
  a_entry_price numeric[] := '{}';
  a_confirm_time timestamptz[] := '{}';
  a_confirm_price numeric[] := '{}';
  a_net_move numeric[] := '{}';
  a_duration numeric[] := '{}';
begin
  if p_floor_mode not in ('fixed','trailing') then
    raise exception 'research_directional_change_events: p_floor_mode muss fixed oder trailing sein, war %', p_floor_mode;
  end if;

  for rec in
    select open_time, high, low, close
    from candles
    where symbol='BTCUSDT' and exchange='binance' and interval=p_interval
    order by open_time asc
  loop
    if v_first then
      v_anchor_time := rec.open_time;
      v_anchor_price := rec.low;
      v_ext_time := rec.open_time;
      v_ext_price := rec.high;
      v_mode := 'seeking_up';
      v_first := false;
      continue;
    end if;

    if v_mode = 'seeking_up' then
      if rec.high > v_ext_price then
        v_ext_price := rec.high;
        v_ext_time := rec.open_time;
      end if;
      v_floor := (case when p_floor_mode='fixed' then v_anchor_price else v_ext_price end) * (1 - p_floor_pct);
      v_floor_breached := rec.low <= v_floor;
      v_target_hit := (v_ext_price - v_anchor_price) >= p_target_usd;

      if v_floor_breached then
        v_mode := 'seeking_down';
        v_anchor_time := v_ext_time;
        v_anchor_price := v_ext_price;
        v_ext_time := rec.open_time;
        v_ext_price := rec.low;
      elsif v_target_hit then
        v_event_id := v_event_id + 1;
        a_event_id := array_append(a_event_id, v_event_id);
        a_direction := array_append(a_direction, 'UP');
        a_entry_time := array_append(a_entry_time, v_anchor_time);
        a_entry_price := array_append(a_entry_price, v_anchor_price);
        a_confirm_time := array_append(a_confirm_time, v_ext_time);
        a_confirm_price := array_append(a_confirm_price, v_ext_price);
        a_net_move := array_append(a_net_move, v_ext_price - v_anchor_price);
        a_duration := array_append(a_duration, extract(epoch from (v_ext_time - v_anchor_time)) / 3600.0);
        v_mode := 'seeking_down';
        v_anchor_time := v_ext_time;
        v_anchor_price := v_ext_price;
        v_ext_time := rec.open_time;
        v_ext_price := rec.low;
      end if;

    else
      if rec.low < v_ext_price then
        v_ext_price := rec.low;
        v_ext_time := rec.open_time;
      end if;
      v_floor := (case when p_floor_mode='fixed' then v_anchor_price else v_ext_price end) * (1 + p_floor_pct);
      v_floor_breached := rec.high >= v_floor;
      v_target_hit := (v_anchor_price - v_ext_price) >= p_target_usd;

      if v_floor_breached then
        v_mode := 'seeking_up';
        v_anchor_time := v_ext_time;
        v_anchor_price := v_ext_price;
        v_ext_time := rec.open_time;
        v_ext_price := rec.high;
      elsif v_target_hit then
        v_event_id := v_event_id + 1;
        a_event_id := array_append(a_event_id, v_event_id);
        a_direction := array_append(a_direction, 'DOWN');
        a_entry_time := array_append(a_entry_time, v_anchor_time);
        a_entry_price := array_append(a_entry_price, v_anchor_price);
        a_confirm_time := array_append(a_confirm_time, v_ext_time);
        a_confirm_price := array_append(a_confirm_price, v_ext_price);
        a_net_move := array_append(a_net_move, v_anchor_price - v_ext_price);
        a_duration := array_append(a_duration, extract(epoch from (v_ext_time - v_anchor_time)) / 3600.0);
        v_mode := 'seeking_up';
        v_anchor_time := v_ext_time;
        v_anchor_price := v_ext_price;
        v_ext_time := rec.open_time;
        v_ext_price := rec.high;
      end if;
    end if;
  end loop;

  return query
    select a_event_id[i], a_direction[i], a_entry_time[i], a_entry_price[i],
           a_confirm_time[i], a_confirm_price[i], a_net_move[i], a_duration[i]
    from generate_subscripts(a_event_id, 1) as i
    order by i;
end;
$function$;
