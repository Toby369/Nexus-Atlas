"""Kombinierte 3-Phasen-Klassifikation (Aufwaerts/Abwaerts/Seitwaerts) fuer
das Toby-Setup-Phasen-Projekt, siehe
docs/research/TOBY-SETUP-PHASEN-DEFINITION.md Abschnitt "Strukturelle
Phasen". Kombiniert zwei bereits unabhaengig gebaute/getestete Bausteine:

1. `src.regime.classify_market_regime` -- Indikator-Regime (ADX/+DI/-DI/
   Slope/Bollinger-Bandwidth/ATR-Ratio/Distanz-Z-Score), 5 Labels.
2. `src.swing_structure.classify_swing_structure` -- Knickpunkt-/Swing-
   Pivot-Struktur (HH/HL vs. LH/LL nach Dow-Theorie), 4 Labels.

Nutzer-Entscheidungen 19.09.2026 (per Rueckfrage geklaert):
- Die zwei regime.py-Zusatzfaelle, die nicht direkt in ein 3-Phasen-Modell
  passen (HIGH_VOLA_REVERSION, UNRESOLVED_NEUTRAL), werden in die
  naheliegendste Phase einsortiert (kein 4. Bucket).
- Zusaetzlich zur reinen Indikator-Definition wird der Swing-Pivot-Check
  als unabhaengige zweite Bestaetigung verlangt: ein Richtungslabel
  (Aufwaerts/Abwaerts) wird nur vergeben, wenn Indikator-Regime UND
  Swing-Struktur uebereinstimmen. Bei Widerspruch (z.B. Regime bullish,
  Struktur aber MIXED) faellt die Bar auf Seitwaerts zurueck -- konservativ,
  konsistent mit der bereits im Projekt etablierten "lieber keine Aussage
  als eine erfundene"-Philosophie (siehe regime.py UNRESOLVED_NEUTRAL,
  toby_setup_engine.py SL-Tie-Break).

Schritt 1 -- Regime -> gerichteter "Lean" (mit Edge-Case-Mapping):
  TREND_EXPANSION_BULLISH                         -> LEAN_UP
  TREND_EXPANSION_BEARISH                         -> LEAN_DOWN
  VOLA_SQUEEZE_RANGING                            -> LEAN_SIDEWAYS
  HIGH_VOLA_REVERSION, dist_zscore_sma50 > 0       -> LEAN_UP (Kurs aktuell
                                                      oberhalb seines Mittel-
                                                      werts gestreckt)
  HIGH_VOLA_REVERSION, dist_zscore_sma50 <= 0      -> LEAN_DOWN
  UNRESOLVED_NEUTRAL, slope > 0 UND +DI > -DI      -> LEAN_UP (schwacher,
                                                      aber richtungs-
                                                      konsistenter Ansatz
                                                      trotz ADX < 25)
  UNRESOLVED_NEUTRAL, slope < 0 UND -DI > +DI      -> LEAN_DOWN
  UNRESOLVED_NEUTRAL, sonst (inkl. fehlende Daten) -> LEAN_SIDEWAYS

Schritt 2 -- Lean + Swing-Struktur -> finale Phase:
  LEAN_UP   UND STRUCTURE_BULLISH -> AUFWAERTS
  LEAN_DOWN UND STRUCTURE_BEARISH -> ABWAERTS
  sonst                           -> SEITWAERTS
"""

from __future__ import annotations

import pandas as pd

from src.regime import (
    REGIME_HIGH_VOLA_REVERSION,
    REGIME_TREND_EXPANSION_BEARISH,
    REGIME_TREND_EXPANSION_BULLISH,
    REGIME_UNRESOLVED_NEUTRAL,
    REGIME_VOLA_SQUEEZE_RANGING,
    RegimeThresholds,
    classify_market_regime,
)
from src.swing_structure import STRUCTURE_BEARISH, STRUCTURE_BULLISH, classify_swing_structure

PHASE_UP = "AUFWAERTS"
PHASE_DOWN = "ABWAERTS"
PHASE_SIDEWAYS = "SEITWAERTS"

ALL_PHASES = (PHASE_UP, PHASE_DOWN, PHASE_SIDEWAYS)

_LEAN_UP = "LEAN_UP"
_LEAN_DOWN = "LEAN_DOWN"
_LEAN_SIDEWAYS = "LEAN_SIDEWAYS"


def _regime_lean(features: pd.DataFrame, regime: pd.Series) -> pd.Series:
    slope = features["slope"]
    plus_di = features["plus_di"]
    minus_di = features["minus_di"]
    dist_z = features["dist_zscore_sma50"]

    lean = pd.Series(_LEAN_SIDEWAYS, index=features.index, dtype=object)
    lean[regime == REGIME_TREND_EXPANSION_BULLISH] = _LEAN_UP
    lean[regime == REGIME_TREND_EXPANSION_BEARISH] = _LEAN_DOWN
    lean[regime == REGIME_VOLA_SQUEEZE_RANGING] = _LEAN_SIDEWAYS

    is_reversion = regime == REGIME_HIGH_VOLA_REVERSION
    lean[is_reversion & (dist_z > 0)] = _LEAN_UP
    lean[is_reversion & (dist_z <= 0)] = _LEAN_DOWN

    is_neutral = regime == REGIME_UNRESOLVED_NEUTRAL
    weak_up = is_neutral & (slope > 0) & (plus_di > minus_di)
    weak_down = is_neutral & (slope < 0) & (minus_di > plus_di)
    lean[weak_up] = _LEAN_UP
    lean[weak_down] = _LEAN_DOWN
    # is_neutral & ~(weak_up | weak_down) bleibt LEAN_SIDEWAYS (Default).

    return lean


def classify_structural_phase(
    features: pd.DataFrame,
    ohlc: pd.DataFrame,
    regime_thresholds: RegimeThresholds | None = None,
    swing_atr_period: int = 14,
    swing_atr_multiple: float = 2.0,
) -> pd.DataFrame:
    """Kombinierte 3-Phasen-Klassifikation, siehe Modul-Docstring.

    Parameters
    ----------
    features : pd.DataFrame
        Wie von `src.regime.classify_market_regime` gefordert (adx, plus_di,
        minus_di, slope, bandwidth, atr_ratio, dist_zscore_sma50), gleicher
        Index wie `ohlc`.
    ohlc : pd.DataFrame
        Spalten high/low (fuer den Swing-Struktur-Check), gleicher Index wie
        `features`.

    Returns
    -------
    pd.DataFrame mit Spalten: regime, swing_structure, phase -- gleicher
    Index wie `features`/`ohlc`. `phase` ist immer eines von `ALL_PHASES`,
    nie NaN.
    """
    if not features.index.equals(ohlc.index):
        raise ValueError("classify_structural_phase: features und ohlc muessen denselben Index haben.")

    regime = classify_market_regime(features, thresholds=regime_thresholds)
    swing_structure = classify_swing_structure(ohlc, atr_period=swing_atr_period, atr_multiple=swing_atr_multiple)
    lean = _regime_lean(features, regime)

    phase = pd.Series(PHASE_SIDEWAYS, index=features.index, dtype=object)
    phase[(lean == _LEAN_UP) & (swing_structure == STRUCTURE_BULLISH)] = PHASE_UP
    phase[(lean == _LEAN_DOWN) & (swing_structure == STRUCTURE_BEARISH)] = PHASE_DOWN

    return pd.DataFrame(
        {"regime": regime, "swing_structure": swing_structure, "phase": phase},
        index=features.index,
    )
