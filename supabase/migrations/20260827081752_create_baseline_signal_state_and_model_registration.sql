-- Exportiert aus supabase_migrations.schema_migrations (20260827081752 create_baseline_signal_state_and_model_registration)


-- Model A (BASELINE): reine Spiegelung der produktiven Aggregationslogik
-- aus compute-market-state v8 (Score=Summe, Coverage/Agreement-Confidence,
-- +-3-Schwellen) -- byte-genau uebernommen, NICHT veraendert. Nimmt
-- dieselbe factors-jsonb wie experimental_domain_signal_state(), damit
-- Model A und Model B auf exakt denselben Rohdaten verglichen werden.
create or replace function public.baseline_signal_state(p_factors jsonb)
returns jsonb
language sql
stable
as $function$
  with vals as (
    select key as factor_name, (value->>'value')::numeric as v
    from jsonb_each(p_factors)
  ),
  with_data as (
    select factor_name, v from vals where v is not null
  ),
  agg as (
    select
      (select count(*) from vals) as total_factors,
      count(*) as with_data_count,
      coalesce(sum(v), 0) as score,
      count(*) filter (where v > 0) as positive_count,
      count(*) filter (where v < 0) as negative_count
    from with_data
  )
  select jsonb_build_object(
    'data_coverage_pct', round(100.0 * a.with_data_count / nullif(a.total_factors,0), 1),
    'score', a.score,
    'overall_state',
      case
        when a.with_data_count = 0 or (100.0 * a.with_data_count / nullif(a.total_factors,0)) < 40 then 'INSUFFICIENT_DATA'
        when a.score >= 3 then 'BULLISH'
        when a.score <= -3 then 'BEARISH'
        when a.positive_count > 0 and a.negative_count > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when a.with_data_count = 0 or (100.0 * a.with_data_count / nullif(a.total_factors,0)) < 40 then 0
        else round((100.0 * a.with_data_count / nullif(a.total_factors,0) / 100) * (abs(a.score) / a.with_data_count) * 100)
      end,
    'architecture_version', 'baseline_v1'
  )
  from agg a;
$function$;

revoke all on function public.baseline_signal_state(jsonb) from public;
grant execute on function public.baseline_signal_state(jsonb) to anon, authenticated, service_role;

-- Model A und Model B als eingefrorene, versionierte Runs registrieren --
-- gleicher 1D-Split fuer beide, damit sie fair vergleichbar sind.
insert into public.backtest_model_runs
  (model_version, model_family, description, interval, train_start, train_end, validation_start, validation_end, test_start, test_end, factor_config, domain_config, weights, trained_on, is_frozen)
values
  (
    'baseline_v1', 'baseline',
    'Produktive compute-market-state-Logik (v8), 14 Faktoren gleichgewichtet, additive Summe. Unveraendert, dient als Referenz fuer alle anderen Modelle.',
    '1d', '2025-12-19', '2026-05-18', '2026-05-19', '2026-07-07', '2026-07-08', '2026-08-26',
    jsonb_build_object('factors', array['structure','momentum','cvd','oi_price','positioning','orderbook','options','macro','funding','sentiment','trend_strength','trend_regime','vwap_position','basis'], 'thresholds', 'production_v8_unchanged'),
    '{}'::jsonb, '{}'::jsonb, 'none', true
  ),
  (
    'domain_balanced_v1', 'domain_balanced',
    'Phase-3-Experimentalarchitektur: 7 Domaenen, Faktoren werden pro Domaene gemittelt statt summiert. Domaenen zunaechst gleichgewichtet (Gewicht=1.0 je Domaene). Keine gelernten Parameter.',
    '1d', '2025-12-19', '2026-05-18', '2026-05-19', '2026-07-07', '2026-07-08', '2026-08-26',
    jsonb_build_object('factors', array['structure','momentum','cvd','oi_price','positioning','orderbook','options','macro','funding','sentiment','trend_strength','trend_regime','vwap_position','basis']),
    jsonb_build_object('market_structure', array['structure','vwap_position'], 'momentum_trend', array['momentum','trend_strength','trend_regime'], 'order_flow', array['cvd','orderbook'], 'derivatives_leverage', array['oi_price','positioning','funding','basis'], 'options', array['options'], 'macro_liquidity', array['macro'], 'sentiment', array['sentiment']),
    '{}'::jsonb, 'none', true
  )
on conflict (model_version) do nothing;
