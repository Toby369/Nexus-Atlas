-- Exportiert aus supabase_migrations.schema_migrations (20260826180320 add_risk_level_to_market_states)

-- Spec-Vorgabe: State/Confidence/Data Coverage/RISK je Gesamtzustand.
-- Risk ist bewusst von Confidence getrennt: Confidence misst die Einigkeit
-- der verfuegbaren Faktoren, Risk misst die Fragilitaet/Gefahr der aktuellen
-- Lage unabhaengig von der Richtung (siehe compute-market-state fuer die
-- Herleitung aus Warn-Patterns/MTF-Uneinigkeit/Funding-Basis-Crowding/
-- erhoehter Volatilitaet). UNKNOWN statt erfundenem Wert, wenn die
-- Datenabdeckung fuer eine seriöse Einordnung zu duenn ist (gleiche
-- Philosophie wie INSUFFICIENT_DATA bei overall_state).
ALTER TABLE public.market_states
  ADD COLUMN risk_level text CHECK (risk_level = ANY (ARRAY['LOW','MEDIUM','HIGH','UNKNOWN'])),
  ADD COLUMN risk_factors jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.market_states.risk_level IS 'Fragilitaets-/Gefahren-Einordnung (LOW/MEDIUM/HIGH/UNKNOWN), unabhaengig von Confidence und Richtung -- siehe risk_factors fuer die Herleitung.';
COMMENT ON COLUMN public.market_states.risk_factors IS 'Liste der ausgeloesten Risiko-Indikatoren (z.B. warning_pattern, low_mtf_alignment, funding_crowding, basis_crowding, elevated_volatility) -- vollstaendig nachvollziehbar, kein Black-Box-Score.';
