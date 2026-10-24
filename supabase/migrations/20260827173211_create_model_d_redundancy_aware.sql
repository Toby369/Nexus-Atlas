-- Exportiert aus supabase_migrations.schema_migrations (20260827173211 create_model_d_redundancy_aware)


-- Model D: redundanzbewusste Domain-Struktur. Direkt aus dem TRAIN-only
-- Korrelationsbefund abgeleitet (siehe docs/research/phase6-factor-
-- diagnostics.md): auf TRAIN (n=151) liegen 13 von 15 Paaren der 6
-- verfuegbaren Faktoren bei r>=0.53 (staerker als auf TRAIN+VALIDATION
-- kombiniert), nur structure_vs_cvd (0.386) und cvd_vs_trend_regime
-- (0.343) liegen klar darunter. Mit einem dokumentierten, konservativen
-- Single-Linkage-Schwellenwert von REDUNDANCY_THRESHOLD=0.55 verschmelzen
-- alle 6 Faktoren (via momentum als Bruecke: cvd-momentum=0.619) zu EINEM
-- Cluster -- die 3 bisherigen Domains market_structure/momentum_trend/
-- order_flow sind auf dieser Datenbasis empirisch NICHT trennbar.
--
-- Model D fasst diese 6 Faktoren deshalb zu einer einzigen Domaene
-- "trend_composite" zusammen (Mittelwert, wie bei jeder Domain-
-- Aggregation), statt sie in 3 separate, aber stark korrelierte Domains
-- zu teilen. Die anderen 4 Domains (derivatives_leverage/options/
-- macro_liquidity/sentiment) bleiben unveraendert -- fuer sie liegt auf
-- TRAIN/VALIDATION keine Korrelationsevidenz vor (0% Coverage), daher
-- keine Aenderung an ihrer Struktur. Keine zusaetzliche Gewichtung
-- obendrauf -- eine Aenderung (Domain-Struktur) pro Modell, um Ergebnisse
-- interpretierbar zu halten.
create or replace function public.redundancy_aware_v1_signal_state(p_factors jsonb)
returns jsonb
language sql
stable
as $function$
  with domain_map(factor_name, domain) as (
    values
      ('structure', 'trend_composite'), ('vwap_position', 'trend_composite'),
      ('momentum', 'trend_composite'), ('trend_strength', 'trend_composite'), ('trend_regime', 'trend_composite'),
      ('cvd', 'trend_composite'),
      ('oi_price', 'derivatives_leverage'), ('positioning', 'derivatives_leverage'),
      ('funding', 'derivatives_leverage'), ('basis', 'derivatives_leverage'),
      ('options', 'options'), ('macro', 'macro_liquidity'), ('sentiment', 'sentiment')
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
    select * from domain_agg where domain_score is not null
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score), 0) as weighted_score,
      count(*) filter (where domain_score > 0) as positive_domains,
      count(*) filter (where domain_score < 0) as negative_domains
    from domain_with_data
  )
  select jsonb_build_object(
    'domain_scores', (
      select coalesce(jsonb_object_agg(domain, jsonb_build_object(
        'score', round(domain_score, 4), 'factors_with_data', factors_with_data, 'factors_total', factors_total
      )), '{}'::jsonb)
      from domain_agg
    ),
    'domain_coverage_pct', case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.domains_total = 0 or o.domains_with_data = 0 or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 'INSUFFICIENT_DATA'
        -- Schwelle proportional zu 5 statt 7 Domains skaliert (1.5 * 5/7),
        -- gleiche Grundlogik wie Model B/C, keine neue Kalibrierung.
        when o.weighted_score >= 1.07 then 'BULLISH'
        when o.weighted_score <= -1.07 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.domains_total = 0 or o.domains_with_data = 0 or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 0
        else round((o.domains_with_data::numeric / o.domains_total) * (abs(o.weighted_score) / o.domains_with_data) * 100)
      end,
    'architecture_version', 'redundancy_aware_v1',
    'note', 'Model D -- 6 Faktoren (structure/momentum/cvd/trend_strength/trend_regime/vwap_position) zu EINER Domain trend_composite zusammengefasst, empirisch aus TRAIN-Korrelation (Schwelle 0.55, Single-Linkage) abgeleitet, nicht aus einer Vorab-Annahme.'
  )
  from overall o;
$function$;

revoke all on function public.redundancy_aware_v1_signal_state(jsonb) from public;
grant execute on function public.redundancy_aware_v1_signal_state(jsonb) to anon, authenticated, service_role;

insert into public.backtest_model_runs
  (model_version, model_family, description, interval, train_start, train_end, validation_start, validation_end, test_start, test_end, factor_config, domain_config, weights, trained_on, is_frozen)
values (
  'redundancy_aware_v1', 'redundancy_aware',
  'Model D: 6 hochkorrelierte Faktoren (r>=0.55 auf TRAIN, single-linkage) zu einer Domaene trend_composite zusammengefasst statt 3 separater Domains. Direkt aus Phase-6-Redundanzbefund abgeleitet.',
  '1d', '2025-12-19', '2026-05-18', '2026-05-19', '2026-07-07', '2026-07-08', '2026-08-26',
  jsonb_build_object('factors', array['structure','momentum','cvd','oi_price','positioning','orderbook','options','macro','funding','sentiment','trend_strength','trend_regime','vwap_position','basis']),
  jsonb_build_object('trend_composite', array['structure','momentum','cvd','trend_strength','trend_regime','vwap_position'], 'derivatives_leverage', array['oi_price','positioning','funding','basis'], 'options', array['options'], 'macro_liquidity', array['macro'], 'sentiment', array['sentiment']),
  jsonb_build_object('redundancy_threshold', 0.55, 'clustering_method', 'single_linkage', 'source', 'TRAIN only correlation matrix'),
  'train', true
)
on conflict (model_version) do nothing;
