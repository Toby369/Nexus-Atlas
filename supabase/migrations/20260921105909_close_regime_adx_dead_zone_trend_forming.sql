-- Exportiert aus supabase_migrations.schema_migrations (20260921105909 close_regime_adx_dead_zone_trend_forming)

-- Toby-Feedback 21.09.2026: Preis lief +2.96%/4h, +3.35%/12h klar bullisch,
-- "Marktphase" zeigte trotzdem 9 Stunden durchgehend UNRESOLVED_NEUTRAL,
-- obwohl ADX durchgehend 20.5-24.7 lag und +DI/-DI + Regressionssteigung
-- die ganze Zeit uebereinstimmend bullisch waren. Ursache: classify_market_
-- regime() kannte nur ADX>=25 (Trendausweitung) und ADX<20+bandwidth<=0.05
-- (Squeeze) -- die Zone ADX 20-24.99 fiel bei JEDER Richtungs-Uebereinstimmung
-- auf UNRESOLVED_NEUTRAL zurueck, komplett unabhaengig davon, wie lange/klar
-- +DI/-DI und Steigung schon uebereinstimmten. Diese "tote Zone" war laut
-- research-python/src/regime.py::RegimeThresholds.adx_range_threshold
-- bewusst als Anti-Flacker-Puffer gedacht (ein einzelner rauschiger ADX-Print
-- soll das Regime nicht hin- und herspringen lassen) -- bei einer ueber
-- Stunden anhaltenden Uebereinstimmung ist das aber keine Flacker-Vermeidung
-- mehr, sondern ein blinder Fleck.
--
-- Fix: zwei neue, schwaechere Regime-Label TREND_FORMING_BULLISH/BEARISH
-- fuer genau die ADX-20-25-Zone bei uebereinstimmender Richtung (+DI/-DI +
-- Steigung) -- ersetzt dort UNRESOLVED_NEUTRAL durch eine ehrliche,
-- abgeschwaechte Richtungsaussage ("Trend bildet sich, aber ADX noch nicht
-- ueber der Wilder-Schwelle 25") statt weiterhin "unklar" zu behaupten.
-- TREND_EXPANSION_BULLISH/BEARISH (ADX>=25) und VOLA_SQUEEZE_RANGING
-- (ADX<20) bleiben unveraendert unberuehrt (disjunkte ADX-Baender).
CREATE OR REPLACE FUNCTION public.classify_market_regime(p_adx numeric, p_plus_di numeric, p_minus_di numeric, p_slope numeric, p_bandwidth numeric, p_atr_ratio numeric, p_dist_zscore_sma50 numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_adx is null or p_plus_di is null or p_minus_di is null or p_slope is null
      or p_bandwidth is null or p_atr_ratio is null or p_dist_zscore_sma50 is null
      then 'UNRESOLVED_NEUTRAL'
    when p_atr_ratio > 1.5 and abs(p_dist_zscore_sma50) > 2.0
      then 'HIGH_VOLA_REVERSION'
    when p_adx >= 25 and p_plus_di > p_minus_di and p_slope > 0
      then 'TREND_EXPANSION_BULLISH'
    when p_adx >= 25 and p_minus_di > p_plus_di and p_slope < 0
      then 'TREND_EXPANSION_BEARISH'
    when p_adx >= 20 and p_adx < 25 and p_plus_di > p_minus_di and p_slope > 0
      then 'TREND_FORMING_BULLISH'
    when p_adx >= 20 and p_adx < 25 and p_minus_di > p_plus_di and p_slope < 0
      then 'TREND_FORMING_BEARISH'
    when p_adx < 20 and p_bandwidth <= 0.05
      then 'VOLA_SQUEEZE_RANGING'
    else 'UNRESOLVED_NEUTRAL'
  end;
$function$;

-- Bestehende market_state_matrix-Zeilen mit der neuen Klassifikation neu
-- berechnen (reine Funktion aus bereits gespeicherten Spalten derselben
-- Zeile -- kein Datenverlust, nur konsistente Neubewertung der Historie).
UPDATE market_state_matrix
SET regime = classify_market_regime(adx_14, plus_di, minus_di, linreg_slope, bb_width, atr_ratio, dist_zscore_sma50)
WHERE regime = 'UNRESOLVED_NEUTRAL';
