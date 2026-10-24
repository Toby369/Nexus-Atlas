-- Exportiert aus supabase_migrations.schema_migrations (20260827171524 add_defensive_coverage_rule_test)


create or replace function public.run_defensive_coverage_rule_test()
returns setof text
language plpgsql
as $$
declare
  v_baseline jsonb; v_domain jsonb; v_calib jsonb;
begin
  return next plan(3);
  select public.baseline_signal_state('{}'::jsonb) into v_baseline;
  return next is(v_baseline->>'overall_state', 'INSUFFICIENT_DATA', 'Model A: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL (Phase-6 Section 5)');
  select public.experimental_domain_signal_state('{}'::jsonb) into v_domain;
  return next is(v_domain->>'overall_state', 'INSUFFICIENT_DATA', 'Model B: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL');
  select public.calibrated_v1_signal_state('{}'::jsonb) into v_calib;
  return next is(v_calib->>'overall_state', 'INSUFFICIENT_DATA', 'Model C: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL');
  return next finish();
end;
$$;
revoke all on function public.run_defensive_coverage_rule_test() from public, anon, authenticated;
grant execute on function public.run_defensive_coverage_rule_test() to service_role;
