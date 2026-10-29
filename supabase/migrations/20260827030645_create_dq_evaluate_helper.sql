-- Exportiert aus supabase_migrations.schema_migrations (20260827030645 create_dq_evaluate_helper)

-- Zentrale Bewertungsfunktion, von refresh_data_quality() fuer jede
-- Quelle/Metrik aufgerufen. Getrennt gehalten, damit die Status-/Score-
-- Logik an EINER Stelle steht statt in jedem Tabellen-Block wiederholt zu
-- werden.
--
-- Praezedenz (schwerwiegendster Zustand zuerst):
--   1. UNKNOWN  -- noch nie erfolgreich abgerufen
--   2. ERROR    -- juengster Einzelversuch ist fehlgeschlagen
--   3. STALE    -- Alter der Daten liegt ueber dem Toleranzfenster
--                 (expected_update_interval * staleness_multiplier)
--   4. DEGRADED -- quality_score < 60 (z.B. erhoehte Fehlerrate/Luecken)
--   5. VALIDATED-- quality_score >= 60, keine Fehler/Luecken im Fenster
--   6. LIVE     -- frisch und fehlerfrei, aber (noch) nicht "VALIDATED"
--                 (z.B. weil missing/error-Rate nicht messbar ist)
--
-- quality_score (0-100) = Frische (0-50) + Zuverlaessigkeit (0-30) +
-- Vollstaendigkeit (0-20). Bewusst UNABHAENGIG von Market-State-Confidence
-- -- misst ausschliesslich, wie gut die Rohdaten selbst sind.
create or replace function public._dq_evaluate(
  p_last_success_at timestamptz,
  p_data_timestamp timestamptz,
  p_expected_interval_seconds integer,
  p_staleness_multiplier numeric,
  p_error_rate numeric,      -- 0..1, NULL wenn nicht messbar (keine Status-Spalte)
  p_missing_value_rate numeric, -- 0..1, NULL wenn nicht messbar
  p_latest_is_error boolean  -- true = juengster Einzelversuch war ein Fehler
)
returns table(status text, quality_score numeric)
language plpgsql
stable
as $$
declare
  v_age_seconds numeric;
  v_freshness numeric;
  v_reliability numeric;
  v_completeness numeric;
  v_score numeric;
begin
  if p_last_success_at is null then
    return query select 'UNKNOWN'::text, null::numeric;
    return;
  end if;

  v_age_seconds := extract(epoch from (now() - coalesce(p_data_timestamp, p_last_success_at)));

  -- Frische: volle Punktzahl bis zum erwarteten Intervall, danach linearer
  -- Abfall bis zur Stale-Schwelle.
  v_freshness := case
    when v_age_seconds <= p_expected_interval_seconds then 50
    when v_age_seconds >= p_expected_interval_seconds * p_staleness_multiplier then 0
    else 50 * (1 - (v_age_seconds - p_expected_interval_seconds) / (p_expected_interval_seconds * (p_staleness_multiplier - 1)))
  end;

  v_reliability := coalesce(30 * (1 - p_error_rate), 30);
  v_completeness := coalesce(20 * (1 - p_missing_value_rate), 20);
  v_score := round(greatest(0, least(100, v_freshness + v_reliability + v_completeness))::numeric, 2);

  if coalesce(p_latest_is_error, false) then
    return query select 'ERROR'::text, v_score;
  elsif v_age_seconds > p_expected_interval_seconds * p_staleness_multiplier then
    return query select 'STALE'::text, v_score;
  elsif v_score < 60 then
    return query select 'DEGRADED'::text, v_score;
  elsif v_score >= 60 and coalesce(p_missing_value_rate, 0) = 0 and coalesce(p_error_rate, 0) = 0 then
    return query select 'VALIDATED'::text, v_score;
  else
    return query select 'LIVE'::text, v_score;
  end if;
end;
$$;

comment on function public._dq_evaluate(timestamptz, timestamptz, integer, numeric, numeric, numeric, boolean) is 'Zentrale Status-/Score-Bewertung fuer den Data-Quality-Layer. Siehe Kommentar im Funktionskoerper fuer die Praezedenz-Reihenfolge.';
