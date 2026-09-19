"""Python-Port von `lib/momentumDivergence.ts` (Nexus Atlas Dashboard-
Prototyp, 2026-09-xx) fuer das Toby-Setup-Phasen-Signal-Projekt, siehe
docs/research/TOBY-SETUP-PHASEN-DEFINITION.md, Signalgruppe "Momentum".

Original-Regel (TypeScript, `detectMomentumDivergence`): ADX>=25 (etablierter
Trend, Wilders klassische Schwelle) UND MACD-Histogramm-Vorzeichen
widerspricht der klassifizierten Richtung. Hier auf eine gerichtete Reihe
(statt der Produktions-`overall_state`-Klassifikation) angewendet: Richtung
kommt vom Vorzeichen des MACD-Histogramms selbst ist NICHT verfuegbar ohne
externe Richtungsangabe -- fuer dieses Forschungsprojekt wird daher direkt
mit der DI-Differenz (`plus_di - minus_di`, Vorzeichen = Trendrichtung nach
ADX/DMI) als Richtungsreferenz gearbeitet: das Signal feuert, wenn ADX>=25
UND das MACD-Histogramm-Vorzeichen der DI-Richtung widerspricht (z.B.
+DI>-DI, aber MACD-Histogramm<0).

Bewusst OHNE den `overall_state`-Bezug der Produktionsversion (der wuerde
auf die hier zu testende Phase zurueckgreifen -- Zirkularitaetsrisiko, siehe
Definitions-Dokument).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

ESTABLISHED_TREND_ADX = 25.0


def detect_momentum_divergence(
    adx: pd.Series,
    plus_di: pd.Series,
    minus_di: pd.Series,
    macd_histogram: pd.Series,
) -> pd.Series:
    """Boolesches Signal je Bar: etablierter Trend (ADX>=25) UND das MACD-
    Histogramm-Vorzeichen widerspricht der DI-Richtung. `False` (nicht NaN)
    wenn eine Eingabe fehlt oder ADX<25 -- fehlende Bestaetigungsmoeglichkeit
    ist kein Divergenz-Ereignis.

    Returns
    -------
    pd.Series[bool], gleicher Index wie die Eingaben.
    """
    established = adx >= ESTABLISHED_TREND_ADX
    di_bullish = plus_di > minus_di
    di_bearish = minus_di > plus_di
    contradicts = (di_bullish & (macd_histogram < 0)) | (di_bearish & (macd_histogram > 0))

    triggered = established & contradicts
    complete = adx.notna() & plus_di.notna() & minus_di.notna() & macd_histogram.notna()
    return (triggered & complete).fillna(False).rename("momentum_divergence")
