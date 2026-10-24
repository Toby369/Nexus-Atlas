-- Exportiert aus supabase_migrations.schema_migrations (20260827082540 create_calibrated_v1_model)


-- Model C (C1: Domain-Gewichte, mild regularisiert). Gewichte NUR fuer die
-- 3 Domaenen mit echter TRAIN-Abdeckung gelernt (market_structure,
-- momentum_trend, order_flow) -- Herleitung siehe backtest_model_runs.weights
-- und Kommentar unten. Die anderen 4 Domaenen bleiben bei Gewicht 1.0
-- (=INSUFFICIENT_DATA fuer Kalibrierung, keine Phantom-Gewichte).
--
-- Herleitung (TRAIN, 24h-Horizont, gemittelt ueber BULLISH+BEARISH-Edge
-- der jeweiligen Domaene GEGEN IHRE EIGENE Preis-Baseline):
--   market_structure: (+2.4pp + +4.4pp)/2 = +3.4pp  -> Gewicht 1.17
--   momentum_trend:   (+0.9pp + -3.7pp)/2 = -1.4pp  -> Gewicht 0.93
--   order_flow:       (-0.1pp + -2.1pp)/2 = -1.1pp  -> Gewicht 0.945
-- Formel: weight = clip(1 + SHRINKAGE_K * avg_edge_pp, 0.5, 2.0), mit
-- SHRINKAGE_K = 0.05 (benannte, dokumentierte Konstante -- bewusst mild,
-- damit ein paar Prozentpunkte Stichproben-Rauschen bei n=53-81 nicht zu
-- extremen Gewichten fuehren; das ist die Regularisierung, keine freie
-- Gewichtsoptimierung).
create or replace function public.calibrated_v1_signal_state(p_factors jsonb)
returns jsonb
language sql
stable
as $function$
  with domain_map(factor_name, domain) as (
    values
      ('structure', 'market_structure'), ('vwap_position', 'market_structure'),
      ('momentum', 'momentum_trend'), ('trend_strength', 'momentum_trend'), ('trend_regime', 'momentum_trend'),
      ('cvd', 'order_flow'), ('orderbook', 'order_flow'),
      ('oi_price', 'derivatives_leverage'), ('positioning', 'derivatives_leverage'),
      ('funding', 'derivatives_leverage'), ('basis', 'derivatives_leverage'),
      ('options', 'options'), ('macro', 'macro_liquidity'), ('sentiment', 'sentiment')
  ),
  domain_weights(domain, weight) as (
    values
      ('market_structure', 1.17), ('momentum_trend', 0.93), ('order_flow', 0.945),
      ('derivatives_leverage', 1.0), ('options', 1.0), ('macro_liquidity', 1.0), ('sentiment', 1.0)
  ),
  factor_values as (
    select dm.factor_name, dm.domain, nullif(p_factors -> dm.factor_name ->> 'value', '')::numeric as value
    from domain_map dm
  ),
  domain_agg as (
    select domain, avg(value) as domain_score, count(value) as factors_with_data, count(*) as factors_total
    from factor_values group by domain
  ),
  domain_with_data as (
    select da.*, dw.weight from domain_agg da join domain_weights dw using (domain) where da.domain_score is not null
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score * weight), 0) as weighted_score,
      coalesce(sum(weight), 0) as weight_sum,
      count(*) filter (where domain_score * weight > 0) as positive_domains,
      count(*) filter (where domain_score * weight < 0) as negative_domains
    from domain_with_data
  )
  select jsonb_build_object(
    'domain_scores', (
      select coalesce(jsonb_object_agg(da.domain, jsonb_build_object(
        'score', round(da.domain_score, 4), 'weight', dw.weight,
        'weighted_score', round(da.domain_score * dw.weight, 4),
        'factors_with_data', da.factors_with_data, 'factors_total', da.factors_total
      )), '{}'::jsonb)
      from domain_agg da join domain_weights dw using (domain)
    ),
    'domain_coverage_pct', case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.domains_total = 0 or o.domains_with_data = 0 or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 1.5 then 'BULLISH'
        when o.weighted_score <= -1.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.domains_total = 0 or o.domains_with_data = 0 or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 0
        else round((o.domains_with_data::numeric / o.domains_total) * (abs(o.weighted_score) / nullif(o.weight_sum,0)) * 100)
      end,
    'architecture_version', 'calibrated_v1',
    'note', 'Domain-Gewichte NUR aus TRAIN gelernt (market_structure/momentum_trend/order_flow), mild regularisiert (SHRINKAGE_K=0.05, geclippt [0.5,2.0]). derivatives_leverage/options/macro_liquidity/sentiment bleiben bei 1.0 -- TRAIN-Historie dort unzureichend (siehe Phase-5-Audit).'
  )
  from overall o;
$function$;

revoke all on function public.calibrated_v1_signal_state(jsonb) from public;
grant execute on function public.calibrated_v1_signal_state(jsonb) to anon, authenticated, service_role;

insert into public.backtest_model_runs
  (model_version, model_family, description, interval, train_start, train_end, validation_start, validation_end, test_start, test_end, factor_config, domain_config, weights, trained_on, is_frozen)
values
  (
    'calibrated_v1', 'calibrated',
    'C1: Domain-Gewichte statt Faktor-Gewichte, ausschliesslich aus TRAIN gelernt fuer die 3 Domaenen mit ausreichender TRAIN-Abdeckung (market_structure, momentum_trend, order_flow), mild regularisiert (SHRINKAGE_K=0.05, Clip [0.5,2.0]). Restliche 4 Domaenen bei Gewicht 1.0 (INSUFFICIENT_DATA fuer Kalibrierung).',
    '1d', '2025-12-19', '2026-05-18', '2026-05-19', '2026-07-07', '2026-07-08', '2026-08-26',
    jsonb_build_object('factors', array['structure','momentum','cvd','oi_price','positioning','orderbook','options','macro','funding','sentiment','trend_strength','trend_regime','vwap_position','basis']),
    jsonb_build_object('market_structure', array['structure','vwap_position'], 'momentum_trend', array['momentum','trend_strength','trend_regime'], 'order_flow', array['cvd','orderbook'], 'derivatives_leverage', array['oi_price','positioning','funding','basis'], 'options', array['options'], 'macro_liquidity', array['macro'], 'sentiment', array['sentiment']),
    jsonb_build_object('market_structure', 1.17, 'momentum_trend', 0.93, 'order_flow', 0.945, 'derivatives_leverage', 1.0, 'options', 1.0, 'macro_liquidity', 1.0, 'sentiment', 1.0, 'shrinkage_k', 0.05, 'calibration_source', 'TRAIN only, 24h horizon, avg of BULLISH+BEARISH edge per domain'),
    'train', true
  )
on conflict (model_version) do nothing;
