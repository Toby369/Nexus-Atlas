-- Exportiert aus supabase_migrations.schema_migrations (20260913113147 create_regime_extend_activation_round4_crossasset)


-- 12.09.2026 -- Runde 4 des Gesamteinschaetzung-Score-Protokolls:
-- Cross-Asset-Korrelation, siehe docs/research/
-- GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md Abschnitt
-- "Runde 4 -- Vorregistrierung" fuer die Hypothesen (VOR diesem Commit
-- fixiert). Point-in-time-Join gegen macro_snapshots: juengste Zeile mit
-- timestamp_utc <= evaluation_time, gleiches Muster wie
-- get_macro_regime_asof().
create or replace function research_regime_extend_activation_round4() returns void
language plpgsql
as $function$
begin
  -- Kandidat 1: DXY-Bewegung -- UP (faellt < -0.3%) und DOWN (steigt > +0.3%).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'DXY-Bewegung', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then m.change_pct < -0.3 else m.change_pct > 0.3 end
      from macro_snapshots m
      where m.symbol = 'DX-Y.NYB' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: S&P-500-Bewegung -- UP (> +0.5%) und DOWN (< -0.5%).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'S&P-500-Bewegung', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then m.change_pct > 0.5 else m.change_pct < -0.5 end
      from macro_snapshots m
      where m.symbol = '^GSPC' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 3: Nasdaq-Bewegung -- UP (> +0.5%) und DOWN (< -0.5%).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Nasdaq-Bewegung', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then m.change_pct > 0.5 else m.change_pct < -0.5 end
      from macro_snapshots m
      where m.symbol = '^IXIC' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 4: VIX erhoeht (>25) -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'VIX erhöht', 'DOWN', e.outcome,
    coalesce((
      select m.last_price > 25
      from macro_snapshots m
      where m.symbol = '^VIX' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 5: Net-Liquidity steigt (Fed-Bilanz - TGA - RRP, > +0.5%) -- NUR UP.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Net-Liquidity steigt', 'UP', e.outcome,
    coalesce((
      with vals as (
        select
          (select m.last_price from macro_snapshots m where m.symbol='WALCL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as walcl_now,
          (select m.prev_close from macro_snapshots m where m.symbol='WALCL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as walcl_prev,
          (select m.last_price from macro_snapshots m where m.symbol='WTREGEN' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as tga_now,
          (select m.prev_close from macro_snapshots m where m.symbol='WTREGEN' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as tga_prev,
          (select m.last_price from macro_snapshots m where m.symbol='RRPONTSYD' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as rrp_now,
          (select m.prev_close from macro_snapshots m where m.symbol='RRPONTSYD' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as rrp_prev
      )
      select
        (walcl_now - tga_now - rrp_now - (walcl_prev - tga_prev - rrp_prev))
          / nullif(abs(walcl_prev - tga_prev - rrp_prev), 0) * 100 > 0.5
      from vals
      where walcl_now is not null and walcl_prev is not null and tga_now is not null
        and tga_prev is not null and rrp_now is not null and rrp_prev is not null
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 6: USD/JPY faellt (Yen staerker, < -0.3%) -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'USD/JPY fällt', 'DOWN', e.outcome,
    coalesce((
      select m.change_pct < -0.3
      from macro_snapshots m
      where m.symbol = 'JPY=X' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 7: Gold-Bewegung -- Ko-Bewegung: UP (> +0.5%), DOWN (< -0.5%).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Gold-Bewegung', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then m.change_pct > 0.5 else m.change_pct < -0.5 end
      from macro_snapshots m
      where m.symbol = 'GC=F' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;
