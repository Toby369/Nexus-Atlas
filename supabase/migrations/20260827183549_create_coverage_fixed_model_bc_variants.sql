-- Exportiert aus supabase_migrations.schema_migrations (20260827183549 create_coverage_fixed_model_bc_variants)


-- Phase 1, Aufgabe C: Coverage-Bug-Fix fuer Model B/C. Bestaetigt (SQL-
-- Check, siehe PHASE-1-VALIDATION-INTEGRITY.md): der domain-count-basierte
-- Bug existiert strukturell auch in Model B/C (dieselbe Formel wie im
-- urspruenglich fehlerhaften Model D), ist auf der aktuellen TRAIN+
-- VALIDATION-Datenbasis aber INAKTIV -- 0 von 201 Zeilen betroffen, weil
-- domain_coverage (3/7=42.9%) UND factor_coverage (6/14=42.9%) hier
-- zufaellig auf derselben Seite der 40%-Schwelle liegen. Der Fix wird
-- trotzdem angewendet (dokumentierter Bug, nicht nur Hypothese), aber
-- NICHT an den eingefrorenen Original-Funktionen -- neue _covfix-Varianten,
-- damit is_frozen=true fuer die Original-Modelldefinition unangetastet
-- bleibt und ein sauberer PRE/POST-Vergleich moeglich ist. Coverage-
-- Semantik bleibt identisch (weiterhin 40%-Schwelle, nur auf Faktor- statt
-- Domain-Ebene gemessen) -- keine neue Schwelle erfunden.
create or replace function public.experimental_domain_signal_state_covfix(p_factors jsonb)
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
  factor_coverage as (
    select count(*) filter (where value is not null) as factors_with_data, count(*) as factors_total
    from factor_values
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score), 0) as weighted_score,
      count(*) filter (where domain_score > 0) as positive_domains,
      count(*) filter (where domain_score < 0) as negative_domains,
      (select factors_with_data from factor_coverage) as factors_with_data,
      (select factors_total from factor_coverage) as factors_total
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
    'factor_coverage_pct', round(100.0 * o.factors_with_data / nullif(o.factors_total,0), 1),
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 1.5 then 'BULLISH'
        when o.weighted_score <= -1.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 0
        else round((o.factors_with_data::numeric / o.factors_total) * (abs(o.weighted_score) / o.domains_with_data) * 100)
      end,
    'architecture_version', 'domain_balanced_v1_covfix',
    'note', 'Model B, Coverage-Gate auf Faktor-Ebene (Bugfix, Phase 1) statt Domain-Ebene. Auf aktueller TRAIN+VALIDATION-Basis 0 Zeilen betroffen (Bug war inaktiv, nicht folgenlos falsch).'
  )
  from overall o;
$function$;

revoke all on function public.experimental_domain_signal_state_covfix(jsonb) from public;
grant execute on function public.experimental_domain_signal_state_covfix(jsonb) to anon, authenticated, service_role;

create or replace function public.calibrated_v1_signal_state_covfix(p_factors jsonb)
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
  factor_coverage as (
    select count(*) filter (where value is not null) as factors_with_data, count(*) as factors_total
    from factor_values
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score * weight), 0) as weighted_score,
      coalesce(sum(weight), 0) as weight_sum,
      count(*) filter (where domain_score * weight > 0) as positive_domains,
      count(*) filter (where domain_score * weight < 0) as negative_domains,
      (select factors_with_data from factor_coverage) as factors_with_data,
      (select factors_total from factor_coverage) as factors_total
    from domain_with_data
  )
  select jsonb_build_object(
    'domain_coverage_pct', case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'factor_coverage_pct', round(100.0 * o.factors_with_data / nullif(o.factors_total,0), 1),
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 1.5 then 'BULLISH'
        when o.weighted_score <= -1.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 0
        else round((o.factors_with_data::numeric / o.factors_total) * (abs(o.weighted_score) / nullif(o.weight_sum,0)) * 100)
      end,
    'architecture_version', 'calibrated_v1_covfix',
    'note', 'Model C, Coverage-Gate auf Faktor-Ebene (Bugfix, Phase 1) statt Domain-Ebene. Gewichte unveraendert (keine Reoptimierung).'
  )
  from overall o;
$function$;

revoke all on function public.calibrated_v1_signal_state_covfix(jsonb) from public;
grant execute on function public.calibrated_v1_signal_state_covfix(jsonb) to anon, authenticated, service_role;
