-- Exportiert aus supabase_migrations.schema_migrations (20260827175838 fix_model_d_equivalence_test_precise)


-- Praezisiert nach Untersuchung der 48 "Abweichungen": es sind AUSSCHLIESS-
-- LICH MIXED(A) -> NEUTRAL(D) Faelle -- nie eine andere Kombination, nie
-- BULLISH/BEARISH betroffen. Das ist die korrekte, erwartbare Konsequenz
-- der Domain-Mittelung: MIXED erfordert bei Model A, dass EINZELNE
-- Faktoren gegenlaeufig sind; bei Model D gibt es in diesem Fenster nur
-- eine einzige Domain, die niemals gleichzeitig positiv UND negativ sein
-- kann -- "gegenlaeufige Einzelfaktoren" werden zu "diese eine Domain
-- liegt nahe Null" (NEUTRAL statt MIXED). Kein Bug, sondern der
-- eigentliche Sinn der Redundanzkorrektur.
create or replace function public.run_model_d_tests()
returns setof text
language plpgsql
as $$
declare
  v_ins_data int;
  v_bull_bear_mismatch int;
  v_non_mixed_to_neutral int;
begin
  return next plan(3);

  select case when (redundancy_aware_v1_signal_state('{}'::jsonb)->>'overall_state') = 'INSUFFICIENT_DATA' then 0 else 1 end into v_ins_data;
  return next is(v_ins_data, 0, 'Model D: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL');

  -- BULLISH/BEARISH-Klassifikation ist auf TRAIN+VALIDATION identisch
  -- zwischen Model A und Model D (nur MIXED/NEUTRAL unterscheiden sich).
  select count(*) into v_bull_bear_mismatch
  from backtest_states bs
  where bs.interval='1d' and bs.architecture_version='experimental_domain_v2_phase4_full_asof'
    and bs.candle_open_time < '2026-07-08'
    and (public.baseline_signal_state(bs.factors)->>'overall_state') in ('BULLISH','BEARISH')
    and (public.baseline_signal_state(bs.factors)->>'overall_state')
     <> (public.redundancy_aware_v1_signal_state(bs.factors)->>'overall_state');
  return next is(v_bull_bear_mismatch, 0, 'Model D stimmt mit Model A in JEDER BULLISH/BEARISH-Klassifikation ueberein (TRAIN+VALIDATION)');

  -- Jede verbleibende Abweichung ist ausschliesslich MIXED(A)->NEUTRAL(D).
  select count(*) into v_non_mixed_to_neutral
  from backtest_states bs
  where bs.interval='1d' and bs.architecture_version='experimental_domain_v2_phase4_full_asof'
    and bs.candle_open_time < '2026-07-08'
    and (public.baseline_signal_state(bs.factors)->>'overall_state')
     <> (public.redundancy_aware_v1_signal_state(bs.factors)->>'overall_state')
    and not (
      (public.baseline_signal_state(bs.factors)->>'overall_state') = 'MIXED'
      and (public.redundancy_aware_v1_signal_state(bs.factors)->>'overall_state') = 'NEUTRAL'
    );
  return next is(v_non_mixed_to_neutral, 0, 'Jede Abweichung zwischen Model A und D ist ausschliesslich MIXED->NEUTRAL, nie eine andere Kombination');

  return next finish();
end;
$$;
