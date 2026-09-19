"""Gemeinsame Bausteine fuer die Signalgruppen-Module (`src/signals/`),
1:1-Ports der TypeScript-Primitive aus `lib/swingDetection.ts` -- exakt
dieselbe Semantik, nicht nur "aehnlich", da GUSS/VWAP-Vector in der
Produktion darauf aufbauen.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def ema_series(values: np.ndarray, period: int) -> np.ndarray:
    """SMA-geseedeter EMA-Verlauf, exakt wie `emaSeries()` in
    `lib/swingDetection.ts`: die ersten `period` Werte seeden den Start-EMA
    per einfachem Mittelwert, danach Standard-EMA-Rekursion mit
    k=2/(period+1). NaN (np.nan) fuer alle Indizes vor der Seed-Fertigstellung.

    Bewusst NICHT `pandas.ewm(adjust=False)` (das startet den EMA sofort am
    ersten Wert, nicht SMA-geseedet) -- fuer eine treue Portierung muss die
    Seed-Konvention exakt uebereinstimmen."""
    n = len(values)
    out = np.full(n, np.nan)
    k = 2.0 / (period + 1)
    ema = None
    seed_sum = 0.0
    seed_count = 0
    for i in range(n):
        v = values[i]
        if ema is None:
            seed_sum += v
            seed_count += 1
            if seed_count == period:
                ema = seed_sum / period
                out[i] = ema
        else:
            ema = v * k + ema * (1 - k)
            out[i] = ema
    return out


def detect_fractal_swings(highs: np.ndarray, lows: np.ndarray, lookback: int) -> pd.DataFrame:
    """1:1-Port von `detectFractalSwings()`: ein Hoch/Tief bei Index i gilt
    als bestaetigt, wenn es hoeher/tiefer ist als jede der `lookback` Kerzen
    davor UND danach (symmetrisches Fenster). Ein Swing bei Index i ist
    also erst ab Index i+lookback tatsaechlich BEKANNT -- fuer eine
    kausale Verwendung muss der Aufrufer diese Verzoegerung selbst
    beruecksichtigen (siehe `guss.py::compute_guss_signal`), diese Funktion
    liefert nur die reinen (spaeter bekannten) Swing-Positionen.

    Returns
    -------
    pd.DataFrame (positionaler RangeIndex) mit Spalten: is_swing_high,
    is_swing_low, swing_type ("HH"/"HL"/"LH"/"LL"/None), structure_trend
    ("bullish"/"bearish"/"ranging").
    """
    n = len(highs)
    is_swing_high = np.zeros(n, dtype=bool)
    is_swing_low = np.zeros(n, dtype=bool)

    for i in range(lookback, n - lookback):
        window = range(i - lookback, i + lookback + 1)
        is_high = all(highs[j] < highs[i] for j in window if j != i)
        is_low = all(lows[j] > lows[i] for j in window if j != i)
        is_swing_high[i] = is_high
        is_swing_low[i] = is_low

    swing_type: list[str | None] = [None] * n
    structure_trend = np.full(n, "ranging", dtype=object)
    last_swing_high_price: float | None = None
    last_swing_low_price: float | None = None
    trend = "ranging"

    for i in range(n):
        if is_swing_high[i]:
            if last_swing_high_price is not None:
                swing_type[i] = "HH" if highs[i] > last_swing_high_price else "LH"
            last_swing_high_price = highs[i]
        elif is_swing_low[i]:
            if last_swing_low_price is not None:
                swing_type[i] = "HL" if lows[i] > last_swing_low_price else "LL"
            last_swing_low_price = lows[i]

        if swing_type[i] in ("HH", "HL"):
            trend = "bullish"
        elif swing_type[i] in ("LH", "LL"):
            trend = "bearish"
        structure_trend[i] = trend

    return pd.DataFrame(
        {
            "is_swing_high": is_swing_high,
            "is_swing_low": is_swing_low,
            "swing_type": swing_type,
            "structure_trend": structure_trend,
        }
    )
