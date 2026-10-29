-- Exportiert aus supabase_migrations.schema_migrations (20260827175609 fix_model_d_equivalence_test_scope)


-- Testfehler war meine eigene Fehlannahme, kein Code-Bug: der Test lief
-- ueber ALLE 251 backtest_states-Zeilen (inkl. TEST), wo die 8 sonst
-- leeren Faktoren tatsaechlich vereinzelt Daten haben -- dort koennen
-- Model A (Summe aller verfuegbaren Faktoren) und Model D (Domain-Mittel,
-- mehrere Domains aktiv) sich legitim unterscheiden. Die eigentliche,
-- geprueft-bestaetigte Behauptung gilt nur fuer TRAIN+VALIDATION (dort
-- IST die Coverage der 8 Faktoren real 0%, siehe research_factor_coverage()).
-- Test entsprechend auf TRAIN+VALIDATION eingegrenzt (vor 2026-07-08).
create or replace function public.run_model_d_tests()
returns setof text
language plpgsql
as $$
declare
  v_mismatch int;
  v_ins_data int;
begin
  return next plan(2);

  select case when (redundancy_aware_v1_signal_state('{}'::jsonb)->>'overall_state') = 'INSUFFICIENT_DATA' then 0 else 1 end into v_ins_data;
  return next is(v_ins_data, 0, 'Model D: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL');

  select count(*) into v_mismatch
  from backtest_states bs
  where bs.interval='1d' and bs.architecture_version='experimental_domain_v2_phase4_full_asof'
    and bs.candle_open_time < '2026-07-08'
    and (public.baseline_signal_state(bs.factors)->>'overall_state')
     <> (public.redundancy_aware_v1_signal_state(bs.factors)->>'overall_state');
  return next is(v_mismatch, 0, 'Model D == Model A auf TRAIN+VALIDATION (dort ist nur trend_composite je aktiv, 0% Coverage sonst) -- mathematisch erwartbar');

  return next finish();
end;
$$;
