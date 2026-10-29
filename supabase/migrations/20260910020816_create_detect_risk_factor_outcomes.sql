-- Exportiert aus supabase_migrations.schema_migrations (20260910020816 create_detect_risk_factor_outcomes)


-- Periodischer KI-Rueckblick Phase 1: Risk-Faktoren aus
-- market_states.risk_factors (compute-market-state). Gleiche Transition-
-- Logik wie detect_warning_pattern_outcomes() (nur erster Bar einer
-- zusammenhaengenden Aktiv-Phase).
--
-- direction_expected ist bewusst NULL fuer Risk-Faktoren ohne inhaerente
-- Richtung -- das sind reine Risiko-/Magnitude-Flags, kein Richtungs-
-- signal (siehe compute-market-state-Kommentar "Risk ist bewusst von
-- Confidence/Richtung getrennt"):
--   - warning_pattern: redundant zur musterspezifischen Richtung, die
--     bereits in detect_warning_pattern_outcomes() erfasst wird.
--   - low_mtf_alignment: Zeitrahmen uneins -- keine Richtungsaussage.
--   - elevated_volatility: reine Volatilitaets-Kennzahl, keine Richtung.
-- funding_crowding/basis_crowding HABEN eine inhaerente, vom Faktor selbst
-- bereits kontraer gewertete Richtung (siehe FUNDING_EXTREME_THRESHOLD/
-- BASIS_EXTREME_THRESHOLD-Kommentare in compute-market-state: positive
-- Funding/Basis = Long-Crowding-Risiko = bearisch kontraer gewertet, und
-- umgekehrt) -- diese wird hier aus dem exakt gleichen Vorzeichen
-- abgeleitet, nicht neu erfunden.
create or replace function public.detect_risk_factor_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with state_rows as (
    select
      ms.id,
      ms.created_at,
      coalesce(ms.risk_factors, '[]'::jsonb) as risk_factor_list,
      coalesce(
        ms.factors->'oi_price'->'basis'->>'close_price',
        ms.factors->'vwap_position'->'basis'->>'close_price',
        ms.factors->'basis'->'basis'->>'close_price',
        ms.factors->'trend_regime'->'basis'->>'close_price'
      )::numeric as close_price,
      (ms.factors->'funding'->'basis'->>'avg_current_rate')::numeric as funding_rate,
      (ms.factors->'basis'->'basis'->>'basis_pct')::numeric as basis_pct
    from public.market_states ms
  ),
  factor_defs (factor_name) as (
    values ('warning_pattern'), ('low_mtf_alignment'), ('elevated_volatility'),
           ('funding_crowding'), ('basis_crowding')
  ),
  transitions as (
    select
      sr.id, sr.created_at, sr.close_price, fd.factor_name,
      case fd.factor_name
        when 'funding_crowding' then
          case when sr.funding_rate > 0 then 'bearish' when sr.funding_rate < 0 then 'bullish' else null end
        when 'basis_crowding' then
          case when sr.basis_pct > 0 then 'bearish' when sr.basis_pct < 0 then 'bullish' else null end
        else null
      end as direction_expected,
      (sr.risk_factor_list ? fd.factor_name) as active_now,
      lag(sr.risk_factor_list ? fd.factor_name) over (partition by fd.factor_name order by sr.id) as active_prev
    from state_rows sr
    cross join factor_defs fd
  ),
  fired as (
    select * from transitions
    where active_now and not coalesce(active_prev, false) and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'risk_factor',
    f.factor_name,
    f.direction_expected,
    f.created_at,
    f.close_price,
    h.horizon_hours,
    'market_states',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.detect_risk_factor_outcomes is
  'Periodischer KI-Rueckblick Phase 1 (09.09.2026): backfillt/trackt die 5 Risk-Faktoren aus market_states.risk_factors in signal_outcomes, nur beim ERSTEN Bar einer zusammenhaengenden Aktiv-Phase. direction_expected NULL fuer richtungslose Faktoren (warning_pattern/low_mtf_alignment/elevated_volatility, dort nur Magnitude-Test sinnvoll), aus Funding-/Basis-Vorzeichen abgeleitet fuer funding_crowding/basis_crowding. x Horizonte [4,12,24]h. Idempotent.';
