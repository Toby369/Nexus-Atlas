-- Exportiert aus supabase_migrations.schema_migrations (20260911203438 fix_refresh_stats_min_n_met_not_null)


create or replace function research_confluence_refresh_stats()
returns void
language plpgsql
as $$
declare
  v_signals text[] := array[
    'CVD-Richtung', 'Fear & Greed', 'Makro-Regime', 'Momentum-Faktor (RSI+MACD)',
    'MTF-Alignment', 'Orderbuch-Imbalance', 'Struktur 15m', 'Struktur 1h', 'Struktur 4h',
    'Struktur 1d', 'Trend-Regime (EMA50/200)', 'Trendstaerke (ADX+DI)', 'VWAP-Position'
  ];
begin
  delete from research_confluence_signal_stats
  where pool = 'main' and cell_type = 'signal' and signal_a = any(v_signals);

  insert into research_confluence_signal_stats
    (cell_type, pool, signal_a, signal_b, direction, window_start, window_end, n1, x1, n2, x2, min_n_met)
  select
    'signal', 'main', r.signal_a, null, r.direction,
    min(c.entry_time), max(c.entry_time),
    count(*) filter (where r.is_active),
    count(*) filter (where r.is_active and r.outcome = 'TRAIL_EXIT'),
    count(*) filter (where not r.is_active),
    count(*) filter (where not r.is_active and r.outcome = 'TRAIL_EXIT'),
    false
  from research_confluence_signal_activation r
  join research_swing_setup_chain_results c on c.id = r.setup_id
  where r.signal_a = any(v_signals)
  group by r.signal_a, r.direction;

  delete from research_confluence_signal_stats
  where pool = 'main' and cell_type = 'pair_a' and signal_a = any(v_signals) and signal_b = any(v_signals);

  insert into research_confluence_signal_stats
    (cell_type, pool, signal_a, signal_b, direction, window_start, window_end, n1, x1, n2, x2, min_n_met)
  select
    'pair_a', 'main', a.signal_a, b.signal_a, a.direction,
    min(c.entry_time), max(c.entry_time),
    count(*) filter (where a.is_active and b.is_active),
    count(*) filter (where a.is_active and b.is_active and a.outcome = 'TRAIL_EXIT'),
    count(*) filter (where not (a.is_active and b.is_active)),
    count(*) filter (where not (a.is_active and b.is_active) and a.outcome = 'TRAIL_EXIT'),
    false
  from research_confluence_signal_activation a
  join research_confluence_signal_activation b
    on b.setup_id = a.setup_id and b.direction = a.direction and b.signal_a > a.signal_a
  join research_swing_setup_chain_results c on c.id = a.setup_id
  where a.signal_a = any(v_signals) and b.signal_a = any(v_signals)
  group by a.signal_a, b.signal_a, a.direction;

  update research_confluence_signal_stats s
  set hit_rate1_pct = case when s.n1 > 0 then round(100.0 * s.x1 / s.n1, 1) else null end,
      hit_rate2_pct = case when s.n2 > 0 then round(100.0 * s.x2 / s.n2, 1) else null end,
      wilson1_lower = w1.lower, wilson1_upper = w1.upper,
      wilson2_lower = w2.lower, wilson2_upper = w2.upper,
      z_score = zt.z_score, raw_p_value = zt.raw_p_value,
      min_n_met = (s.n1 >= 10 and s.n2 >= 10),
      raw_significant = (s.n1 >= 10 and s.n2 >= 10 and zt.raw_p_value is not null and zt.raw_p_value < 0.05),
      computed_at = now()
  from research_wilson_ci(s.x1, s.n1) w1
  cross join research_wilson_ci(s.x2, s.n2) w2
  cross join research_two_proportion_ztest(s.x1, s.n1, s.x2, s.n2) zt
  where s.pool = 'main'
    and ((s.cell_type = 'signal' and s.signal_a = any(v_signals))
         or (s.cell_type = 'pair_a' and s.signal_a = any(v_signals) and s.signal_b = any(v_signals)));
end;
$$;
