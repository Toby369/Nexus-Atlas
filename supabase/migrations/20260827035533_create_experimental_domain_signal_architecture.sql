-- Exportiert aus supabase_migrations.schema_migrations (20260827035533 create_experimental_domain_signal_architecture)


-- Phase 3 (Signal Architecture & Factor Independence): additive, NICHT-produktive
-- Experimentalfunktion. Laeuft komplett parallel zur produktiven
-- compute-market-state Edge Function / market_states-Tabelle -- schreibt
-- nirgendwo hin, veraendert keine bestehende Function/Tabelle, wird von
-- keinem Cron-Job aufgerufen.
--
-- Zweck: testbare Struktur fuer raw factor -> normalized factor ->
-- domain score -> independence adjustment -> market state -> confidence
-- (Phase-3-Vorgabe Punkt 7). Nimmt bewusst dieselben, bereits von
-- compute-market-state berechneten -1/0/+1-Faktorwerte als Eingabe (aus
-- market_states.factors), statt die Rohdaten-Sammlung ein zweites Mal zu
-- duplizieren -- das waere fehleranfaellig und wuerde bestehende Collectors
-- unnoetig anfassen (Phase-3-Vorgabe: "keine unnoetigen Aenderungen an
-- bestehenden Collectors").
--
-- Domain-Zuordnung: aus dem TATSAECHLICHEN Code von compute-market-state
-- hergeleitet (siehe Phase-3-Bericht), NICHT blind aus den 10 vom Nutzer
-- vorgeschlagenen Kandidaten-Domaenen uebernommen. Institutional/ETF,
-- On-Chain und News/Event-Risk haben aktuell KEINEN Faktor im 14er-Set
-- (ETF/On-Chain/News werden zwar gesammelt, fliessen aber nicht in
-- compute-market-state ein) -- deshalb hier bewusst NICHT als leere
-- Domaenen aufgefuehrt.
--
-- Unabhaengigkeits-Gewichtung: Platzhalter (1.0 fuer jede Domain). Die
-- bisherige Historie (siehe Phase-3-Korrelationsanalyse: n=19 bis n=73 je
-- nach Paar) reicht nicht aus, um eine kalibrierte Redundanz-Korrektur zu
-- rechtfertigen -- das waere eine verfruehte Gewichtung, die Phase 3
-- explizit ausschliesst ("keine endgueltige Neugewichtung, erst nach
-- historischem Backtesting"). Die Domain-Mittelung selbst (statt Summe wie
-- in compute-market-state) ist der einzige bereits wirksame
-- Unabhaengigkeits-Mechanismus dieser Experimentalarchitektur: sie verhindert
-- strukturell, dass z.B. 4 Faktoren aus derselben Domain (derivatives_leverage:
-- oi_price/positioning/funding/basis) 4x statt 1x gezaehlt werden.
--
-- Schwellenwerte (BULLISH/BEARISH/INSUFFICIENT_DATA) sind bewusst benannte,
-- gegenueber der produktiven Funktion proportional herunterskalierte
-- Platzhalter (7 Domains statt 14 Faktoren) -- KEINE neue Kalibrierung,
-- nur strukturell analog zur bestehenden Logik, damit die Architektur
-- ueberhaupt einen testbaren Zustand liefert.

create or replace function public.experimental_domain_signal_state(p_factors jsonb)
returns jsonb
language sql
stable
as $function$
  with domain_map(factor_name, domain) as (
    values
      ('structure', 'market_structure'),
      ('vwap_position', 'market_structure'),
      ('momentum', 'momentum_trend'),
      ('trend_strength', 'momentum_trend'),
      ('trend_regime', 'momentum_trend'),
      ('cvd', 'order_flow'),
      ('orderbook', 'order_flow'),
      ('oi_price', 'derivatives_leverage'),
      ('positioning', 'derivatives_leverage'),
      ('funding', 'derivatives_leverage'),
      ('basis', 'derivatives_leverage'),
      ('options', 'options'),
      ('macro', 'macro_liquidity'),
      ('sentiment', 'sentiment')
  ),
  factor_values as (
    select
      dm.factor_name,
      dm.domain,
      nullif(p_factors -> dm.factor_name ->> 'value', '')::numeric as value
    from domain_map dm
  ),
  domain_agg as (
    select
      domain,
      avg(value) as domain_score,
      count(value) as factors_with_data,
      count(*) as factors_total
    from factor_values
    group by domain
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
        'score', round(domain_score, 4),
        'factors_with_data', factors_with_data,
        'factors_total', factors_total
      )), '{}'::jsonb)
      from domain_agg
    ),
    'domain_coverage_pct',
      case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.domains_total = 0 or o.domains_with_data = 0
          or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 1.5 then 'BULLISH'
        when o.weighted_score <= -1.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.domains_total = 0 or o.domains_with_data = 0
          or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 0
        else round((o.domains_with_data::numeric / o.domains_total) * (abs(o.weighted_score) / o.domains_with_data) * 100)
      end,
    'independence_weight_applied', 1.0,
    'architecture_version', 'experimental_domain_v1_phase3',
    'note', 'EXPERIMENTAL -- laeuft parallel zur produktiven compute-market-state Funktion, schreibt in keine Tabelle. Independence-Gewichtung ist ein Platzhalter (1.0), da die bisherige Historie fuer eine kalibrierte Redundanz-Korrektur nicht ausreicht.'
  )
  from overall o;
$function$;

revoke all on function public.experimental_domain_signal_state(jsonb) from public;
grant execute on function public.experimental_domain_signal_state(jsonb) to anon, authenticated, service_role;

-- Bequemlichkeits-Wrapper: liest den neuesten market_states-Datensatz und
-- wendet dieselbe (einzige) Logik an -- keine Logik-Duplikation.
create or replace function public.experimental_domain_signal_state_latest()
returns jsonb
language sql
stable
as $function$
  select public.experimental_domain_signal_state(factors)
  from market_states
  order by timestamp_utc desc
  limit 1;
$function$;

revoke all on function public.experimental_domain_signal_state_latest() from public;
grant execute on function public.experimental_domain_signal_state_latest() to anon, authenticated, service_role;
