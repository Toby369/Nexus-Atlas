-- Exportiert aus supabase_migrations.schema_migrations (20260827165519 add_research_coverage_tests)


create or replace function public.run_research_coverage_tests()
returns setof text
language plpgsql
as $$
declare
  v_bad_pct int;
  v_full6 int;
  v_empty8 int;
begin
  return next plan(3);

  select count(*) into v_bad_pct from research_factor_coverage()
  where coverage_pct < 0 or coverage_pct > 100;
  return next is(v_bad_pct, 0, 'coverage_pct liegt fuer jeden Faktor zwischen 0 und 100');

  select count(*) into v_full6 from research_factor_coverage()
  where factor_name in ('structure','momentum','cvd','trend_strength','trend_regime','vwap_position') and coverage_pct = 100.0;
  return next is(v_full6, 6, 'Die 6 marktfeatures-basierten Faktoren zeigen 100% Coverage in TRAIN+VALIDATION');

  select count(*) into v_empty8 from research_factor_coverage()
  where factor_name in ('basis','funding','oi_price','positioning','macro','options','orderbook','sentiment') and coverage_pct = 0.0;
  return next is(v_empty8, 8, 'Die 8 jung-datierten Faktoren zeigen 0% Coverage in TRAIN+VALIDATION -- reale Dateneinschraenkung, kein Bug');

  return next finish();
end;
$$;

revoke all on function public.run_research_coverage_tests() from public, anon, authenticated;
grant execute on function public.run_research_coverage_tests() to service_role;
