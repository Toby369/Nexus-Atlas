-- Exportiert aus supabase_migrations.schema_migrations (20260827174826 fix_model_d_unreachable_threshold)


-- Zweiter Bug in Model D, ebenfalls vor jeder Ergebnis-Meldung gefunden:
-- der Schwellenwert 1.07 war MATHEMATISCH UNERREICHBAR. Er wurde per
-- "0.214 (=1.5/7, das Verhaeltnis aus Model B/C) * 5 Domains" hergeleitet
-- -- das ignoriert, dass in diesem Datensatz strukturell IMMER nur eine
-- einzige Domain (trend_composite) ueberhaupt Daten hat (die anderen 4
-- haben 0% Coverage in TRAIN/VALIDATION). Der maximal erreichbare
-- weighted_score ist damit 1.0 (Durchschnitt von bis zu 6 Faktoren in
-- [-1,1], einzige aktive Domain), nie 1.07 -- die Schwelle haette JEDE
-- Zeile automatisch als NEUTRAL/MIXED klassifiziert, unabhaengig vom
-- tatsaechlichen Signal.
--
-- Fix: fester, aus erster Prinzipien gewaehlter Schwellenwert 0.5 (nicht
-- aus Validation-Ergebnissen zurueckgerechnet) -- verlangt, dass die
-- durchschnittliche Faktor-Richtung in trend_composite klar mehrheitlich
-- ist (bei 6 Faktoren z.B. mindestens netto 3 klar ueberwiegend), analog
-- zur Grundidee von Model A (score>=3 als fester, nicht neu-skalierter
-- Schwellenwert).
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
        when o.weighted_score >= 0.5 then 'BULLISH'
        when o.weighted_score <= -0.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 0
        else round((o.factors_with_data::numeric / o.factors_total) * (abs(o.weighted_score) / o.domains_with_data) * 100)
      end,
    'architecture_version', 'redundancy_aware_v1',
    'note', 'Model D -- 6 Faktoren zu einer Domain trend_composite zusammengefasst (TRAIN-Korrelation >=0.55). Schwellenwert 0.5 fest gewaehlt (aus erster Prinzipien, nicht aus Validation zurueckgerechnet), nach Korrektur eines unerreichbaren Schwellenwerts (1.07 > max. moeglicher Score 1.0 bei strukturell nur einer aktiven Domain in diesem Datensatz).'
  )
  from overall o;
$function$;

select public.backtest_populate_model_results('redundancy_aware_v1');
