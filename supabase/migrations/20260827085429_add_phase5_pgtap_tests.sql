-- Exportiert aus supabase_migrations.schema_migrations (20260827085429 add_phase5_pgtap_tests)


create or replace function public.run_phase5_calibration_tests()
returns setof text
language plpgsql
as $$
declare
  v_overlap int;
  v_gap_days int;
  v_frozen_blocked boolean := false;
  v_c1_weights_in_range int;
begin
  return next plan(4);

  -- Keine Ueberlappung zwischen train/validation/test in irgendeinem
  -- registrierten Model-Run.
  select count(*) into v_overlap
  from backtest_model_runs
  where not (train_end < validation_start and validation_end < test_start);
  return next is(v_overlap, 0, 'Train/Validation/Test ueberlappen sich in keinem Model-Run (chronologisch sauber getrennt)');

  -- Keine Luecke von mehr als 1 Tag zwischen den Splits (sonst Zeilen
  -- stillschweigend verloren).
  select count(*) into v_gap_days
  from backtest_model_runs
  where (validation_start - train_end) > 1 or (test_start - validation_end) > 1;
  return next is(v_gap_days, 0, 'Keine unerklaerte Luecke zwischen den Splits (max. 1 Tag Rundungstoleranz)');

  -- Eingefrorene Modelle sind technisch vor Aenderung geschuetzt (Trigger).
  begin
    update backtest_model_runs set description = 'sollte fehlschlagen' where model_version = 'baseline_v1';
  exception when others then
    v_frozen_blocked := true;
  end;
  return next ok(v_frozen_blocked, 'is_frozen=true verhindert technisch (Trigger) jede Aenderung an der Baseline, nicht nur per Konvention');

  -- Model C: alle 3 gelernten Gewichte liegen im dokumentierten Clip-Bereich [0.5, 2.0].
  select count(*) into v_c1_weights_in_range
  from jsonb_each_text((select weights from backtest_model_runs where model_version='calibrated_v1')) w(k,v)
  where k in ('market_structure','momentum_trend','order_flow')
    and (v::numeric < 0.5 or v::numeric > 2.0);
  return next is(v_c1_weights_in_range, 0, 'Model-C-Domain-Gewichte liegen alle innerhalb des dokumentierten Regularisierungs-Clips [0.5, 2.0]');

  return next finish();
end;
$$;

revoke all on function public.run_phase5_calibration_tests() from public, anon, authenticated;
grant execute on function public.run_phase5_calibration_tests() to service_role;
