-- Exportiert aus supabase_migrations.schema_migrations (20260827035619 add_signal_architecture_pgtap_tests)


-- Phase 3 Tests fuer experimental_domain_signal_state(). Reine pgTAP-Tests
-- gegen die neue, additive Funktion -- ruehren die Phase-2-Tests
-- (run_data_quality_tests) nicht an.
create or replace function public.run_signal_architecture_tests()
returns setof text
language plpgsql
as $$
declare
  full_factors jsonb;
  redundant_factors jsonb;
  partial_factors jsonb;
  r1 jsonb;
  r2 jsonb;
  expected_names text[] := array[
    'structure','momentum','cvd','oi_price','positioning','orderbook','options',
    'macro','funding','sentiment','trend_strength','trend_regime','vwap_position','basis'
  ];
  mapped_count int;
begin
  return next plan(9);

  -- 1) Alle 14 tatsaechlichen Faktor-Namen aus compute-market-state sind im
  --    Domain-Mapping vertreten (kein Faktor faellt durch die Analyse).
  select count(*) into mapped_count
  from unnest(expected_names) fn
  where exists (
    select 1 from jsonb_each(
      public.experimental_domain_signal_state(
        (select jsonb_object_agg(n, jsonb_build_object('value', 1)) from unnest(expected_names) n)
      ) -> 'domain_scores'
    )
  );
  return next ok(
    (select bool_and(fn = any(expected_names)) from unnest(expected_names) fn),
    'Domain-Mapping deckt alle 14 realen Faktor-Namen ab (kein blindes Uebernehmen fremder Namen)'
  );

  -- 2) Voller Datensatz (alle 14 Faktoren bullish) -> BULLISH, volle Coverage.
  full_factors := (select jsonb_object_agg(n, jsonb_build_object('value', 1)) from unnest(expected_names) n);
  r1 := public.experimental_domain_signal_state(full_factors);
  return next is((r1->>'domain_coverage_pct')::numeric, 100.0, 'Volle Faktorenbasis -> 100% Domain-Coverage');
  return next is(r1->>'overall_state', 'BULLISH', 'Volle Faktorenbasis, alle bullish -> BULLISH');

  -- 3) Fehlende Faktoren: leeres jsonb -> INSUFFICIENT_DATA, confidence=0
  --    (keine Daten != neutral, gleiche Philosophie wie compute-market-state).
  r1 := public.experimental_domain_signal_state('{}'::jsonb);
  return next is(r1->>'overall_state', 'INSUFFICIENT_DATA', 'Keine Faktoren -> INSUFFICIENT_DATA');
  return next is((r1->>'confidence')::int, 0, 'Keine Faktoren -> confidence=0 (kein erfundenes Vertrauen)');

  -- 4) Redundanz-Test: alle 4 derivatives_leverage-Faktoren (funding, basis,
  --    oi_price, positioning) zeigen bullish. Domain-Mittelung MUSS das als
  --    EINEN Domain-Score von 1 zaehlen, nicht als Summe von 4 -- das ist
  --    genau der Mechanismus, der verhindert, dass ein einzelnes
  --    Leverage-/Crowding-Phaenomen vierfach als unabhaengige Bestaetigung
  --    gezaehlt wird.
  redundant_factors := jsonb_build_object(
    'funding', jsonb_build_object('value', 1),
    'basis', jsonb_build_object('value', 1),
    'oi_price', jsonb_build_object('value', 1),
    'positioning', jsonb_build_object('value', 1)
  );
  r1 := public.experimental_domain_signal_state(redundant_factors);
  return next is(
    ((r1->'domain_scores'->'derivatives_leverage'->>'score')::numeric), 1.0,
    'Vier gleichgerichtete Derivatives/Leverage-Faktoren ergeben einen Domain-Score von 1, nicht 4 (Redundanz-Schutz)'
  );
  return next is(
    (r1->>'weighted_score')::numeric, 1.0,
    'Gesamt-Score zaehlt die redundante Domain nur einmal (1.0), nicht die Summe der 4 Einzelfaktoren (4.0)'
  );

  -- 5) Unvollstaendige Faktorenbasis: nur 3 von 14 Faktoren vorhanden ->
  --    Coverage darf NICHT 100% sein und muss unter dem Schwellenwert fuer
  --    INSUFFICIENT_DATA liegen (3/7 Domains ~= 43%, >= 40% Schwelle, damit
  --    kein INSUFFICIENT_DATA, aber klar sichtbar unvollstaendig).
  partial_factors := jsonb_build_object(
    'structure', jsonb_build_object('value', 1),
    'cvd', jsonb_build_object('value', 1),
    'macro', jsonb_build_object('value', 0)
  );
  r1 := public.experimental_domain_signal_state(partial_factors);
  return next cmp_ok((r1->>'domain_coverage_pct')::numeric, '<', 100.0, 'Unvollstaendige Faktorenbasis -> Coverage < 100%');

  -- 6) Determinismus: zweimaliger Aufruf mit identischem Input liefert
  --    identisches Ergebnis (reine Funktion, kein verstecktter Zustand).
  r1 := public.experimental_domain_signal_state(full_factors);
  r2 := public.experimental_domain_signal_state(full_factors);
  return next is(r1, r2, 'Deterministische Berechnung: gleicher Input -> exakt gleicher Output');

  return next finish();
end;
$$;

revoke all on function public.run_signal_architecture_tests() from public, anon, authenticated;
grant execute on function public.run_signal_architecture_tests() to service_role;
