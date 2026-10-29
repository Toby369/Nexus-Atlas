-- Exportiert aus supabase_migrations.schema_migrations (20260827190606 add_phase1_validation_integrity_tests)


create or replace function public.run_phase1_validation_integrity_tests()
returns setof text
language plpgsql
as $$
declare
  v_leak_count int;
  v_covfix_diff int;
  v_bh_order_violation int;
begin
  return next plan(3);

  select count(*) into v_leak_count from research_leakage_integrity_log where leakage = true;
  return next is(v_leak_count, 0, 'Kein einziger geprueft Split zeigt Label-Leakage (Purge+Embargo korrekt durchgesetzt)');

  -- Coverage-Fix-Variante von Model B liefert auf TRAIN+VALIDATION exakt
  -- dieselben Klassifikationen wie das Original (Bug war folgenlos, siehe
  -- PHASE-1-VALIDATION-INTEGRITY.md Abschnitt 6).
  select count(*) into v_covfix_diff
  from backtest_states bs
  where bs.interval='1d' and bs.architecture_version='experimental_domain_v2_phase4_full_asof'
    and bs.candle_open_time < '2026-07-08'
    and (bs.domain_result->>'overall_state') <> (public.experimental_domain_signal_state_covfix(bs.factors)->>'overall_state');
  return next is(v_covfix_diff, 0, 'Coverage-Fix aendert auf aktueller TRAIN+VALIDATION-Basis keine einzige Model-B-Klassifikation (Bug war inaktiv)');

  -- BH-kritische Werte sind monoton steigend mit dem Rang (Grundeigenschaft
  -- der Prozedur -- rank/m*alpha).
  select count(*) into v_bh_order_violation
  from (
    select rank, bh_critical_value, lag(bh_critical_value) over (order by rank) as prev
    from research_bh_fdr()
  ) x where prev is not null and bh_critical_value < prev;
  return next is(v_bh_order_violation, 0, 'BH-kritische Werte steigen monoton mit dem Rang (korrekte Prozedur-Implementierung)');

  return next finish();
end;
$$;
revoke all on function public.run_phase1_validation_integrity_tests() from public, anon, authenticated;
grant execute on function public.run_phase1_validation_integrity_tests() to service_role;
