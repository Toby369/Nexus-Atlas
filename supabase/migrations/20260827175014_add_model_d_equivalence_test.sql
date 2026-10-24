-- Exportiert aus supabase_migrations.schema_migrations (20260827175014 add_model_d_equivalence_test)


create or replace function public.run_model_d_tests()
returns setof text
language plpgsql
as $$
declare
  v_mismatch int;
  v_ins_data int;
begin
  return next plan(2);

  -- 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL (gleiche Regel wie A/B/C).
  select case when (redundancy_aware_v1_signal_state('{}'::jsonb)->>'overall_state') = 'INSUFFICIENT_DATA' then 0 else 1 end into v_ins_data;
  return next is(v_ins_data, 0, 'Model D: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL');

  -- Zentraler Befund: in diesem Datensatz (nur trend_composite je aktiv)
  -- ist Model D mathematisch identisch zu Model A -- dieselbe Summe,
  -- durch dieselbe Faktoranzahl geteilt, mit passend skaliertem
  -- Schwellenwert. Test haelt diese Aequivalenz als Regressionsschutz fest.
  select count(*) into v_mismatch
  from backtest_states bs
  where bs.interval='1d' and bs.architecture_version='experimental_domain_v2_phase4_full_asof'
    and (public.baseline_signal_state(bs.factors)->>'overall_state')
     <> (public.redundancy_aware_v1_signal_state(bs.factors)->>'overall_state');
  return next is(v_mismatch, 0, 'Model D == Model A in diesem Datensatz (nur eine Domain je aktiv) -- mathematisch erwartbar, kein Bug');

  return next finish();
end;
$$;
revoke all on function public.run_model_d_tests() from public, anon, authenticated;
grant execute on function public.run_model_d_tests() to service_role;
