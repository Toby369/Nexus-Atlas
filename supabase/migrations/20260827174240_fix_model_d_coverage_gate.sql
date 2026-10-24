-- Exportiert aus supabase_migrations.schema_migrations (20260827174240 fix_model_d_coverage_gate)


-- Bug gefunden und behoben, bevor Ergebnisse gemeldet wurden: Model D
-- fasst 6 Faktoren in EINE Domain zusammen, wodurch die bisherige
-- domain-COUNT-basierte Coverage-Schwelle (domains_with_data/domains_total
-- >= 0.4) bei ungleich grossen Domains falsch wird -- 1 von 5 Domains mit
-- Daten ergibt 20% "Domain-Coverage", obwohl inhaltlich 6 von 14
-- Rohfaktoren (43%) vorliegen. Ergebnis war INSUFFICIENT_DATA in JEDER
-- einzigen TRAIN/VALIDATION-Zeile -- kein Modellversagen, sondern ein
-- Mess-Artefakt der eigenen Coverage-Formel.
--
-- Fix: Coverage-Gate zurueck auf FAKTOR-Ebene (wie Model A urspruenglich
-- definiert: factors_with_data/14), nicht mehr auf Domain-Ebene -- robust
-- gegenueber unterschiedlich grossen Domain-Gruppierungen. Domain-
-- Mittelung (Redundanzschutz) bleibt fuer den Score selbst unveraendert.
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
        when o.weighted_score >= 1.07 then 'BULLISH'
        when o.weighted_score <= -1.07 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 0
        else round((o.factors_with_data::numeric / o.factors_total) * (abs(o.weighted_score) / o.domains_with_data) * 100)
      end,
    'architecture_version', 'redundancy_aware_v1',
    'note', 'Model D -- 6 Faktoren zu einer Domain trend_composite zusammengefasst (TRAIN-Korrelation >=0.55). Coverage-Gate auf Faktor-Ebene (wie Model A), nicht auf Domain-Ebene -- Fix nach einem in Phase 6 selbst gefundenen Bug (domain-count-basierte Coverage war bei ungleich grossen Domains irrefuehrend).'
  )
  from overall o;
$function$;

select public.backtest_populate_model_results('redundancy_aware_v1');
