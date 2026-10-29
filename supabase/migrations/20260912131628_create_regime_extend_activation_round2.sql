-- Exportiert aus supabase_migrations.schema_migrations (20260912131628 create_regime_extend_activation_round2)

-- Gesamteinschaetzung-Score-Protokoll: Runde 2 -- 3 weitere Kandidaten aus
-- den 4 datenknappen neuen Regime-Matrix-Signalen (Abschnitt 2). Bewusst
-- eine NEUE Funktion statt die bestehende research_regime_extend_activation()
-- zu aendern -- "nur Erweiterungen, niemals rueckwirkende Aenderungen an
-- bereits klassifizierten/getesteten Elementen" (Kopfzeile des Protokolls).
--
-- Liquidation-Cluster-Density bewusst NICHT enthalten: ist ein reiner
-- Magnitude-Z-Score (6h-Cluster-Summe vs. 48h-Basis, siehe
-- compute_market_state_matrix_series), ohne erkennbare Richtungsangabe,
-- welche Seite liquidiert wurde -- kein pre-registrierbares Richtungs-
-- Vorzeichen ohne zusaetzliche, hier nicht vorhandene Information.
--
-- OI-vs-Preis-Quadrant: nur die zwei eindeutigen Momentum-Bestaetigungs-
-- Quadranten vorregistriert (long_buildup->UP, short_buildup->DOWN).
-- short_covering/long_unwind bleiben bewusst ungetestet (keine klare
-- Richtungstheorie -- Positionsschliessung ohne implizierte Richtung).

create or replace function research_regime_extend_activation_round2()
returns void
language plpgsql
as $function$
begin
  -- Funding-Z-Score (kontrarisch: hohe positive Z = Crowded Longs -> DOWN,
  -- hohe negative Z = Crowded Shorts -> UP, Schwelle |z|>=1,5)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Funding-Z-Score', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.funding_zscore <= -1.5 else rm.funding_zscore >= 1.5 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Net-Taker-Flow-Ratio (Spot, Momentum: positiv -> UP, negativ -> DOWN)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Net-Taker-Flow-Ratio', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.net_taker_flow_ratio > 0 else rm.net_taker_flow_ratio < 0 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- OI-vs-Preis-Quadrant (nur long_buildup->UP, short_buildup->DOWN)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'OI-Quadrant (Buildup)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.oi_price_quadrant = 'long_buildup' else rm.oi_price_quadrant = 'short_buildup' end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

comment on function research_regime_extend_activation_round2() is
  'Gesamteinschaetzung-Score-Protokoll Runde 2: Funding-Z-Score, Net-Taker-Flow-Ratio, '
  'OI-Quadrant (nur Buildup-Zustaende) -- die 3 testbaren der 4 datenknappen neuen '
  'Regime-Matrix-Signale (Liquidation-Cluster-Density ausgeschlossen, keine Richtungstheorie).';
