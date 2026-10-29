-- Exportiert aus supabase_migrations.schema_migrations (20260913121934 create_regime_extend_activation_round5_m2_cpi_pce)


-- 12.09.2026 -- Runde 5 des Gesamteinschaetzung-Score-Protokolls: M2/CPI/PCE,
-- siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md
-- Abschnitt "Runde 5 -- Vorregistrierung". Publikations-Verzug bereits beim
-- Backfill in macro_snapshots.timestamp_utc eingerechnet (siehe
-- backfill-macro-Kommentar) -- der asof-Join hier ist identisch zu Runde 4.
create or replace function research_regime_extend_activation_round5() returns void
language plpgsql
as $function$
begin
  -- Kandidat 1: M2-Wachstum (jede Zunahme) -- NUR UP.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'M2-Wachstum', 'UP', e.outcome,
    coalesce((
      select m.change_pct > 0
      from macro_snapshots m
      where m.symbol = 'M2SL' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: CPI-Anstieg -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CPI-Anstieg', 'DOWN', e.outcome,
    coalesce((
      select m.change_pct > 0
      from macro_snapshots m
      where m.symbol = 'CPIAUCSL' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 3: PCE-Anstieg -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'PCE-Anstieg', 'DOWN', e.outcome,
    coalesce((
      select m.change_pct > 0
      from macro_snapshots m
      where m.symbol = 'PCEPI' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;
