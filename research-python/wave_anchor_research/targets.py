"""Forward-Return-Targets (Aufgabenstellung Abschnitt 9) -- unabhaengig vom
bestehenden Nexus-3-Zustands-Market-State-Target, wie explizit gefordert.

forward_return = future_close / current_close - 1

MFE/MAE sind bewusst richtungsneutral als Long-Sicht definiert (maximaler
Kursgewinn/-verlust waehrend des Horizonts relativ zum aktuellen Schluss) --
eine SHORT-Interpretation ist das Vorzeichen-Spiegelbild und wird hier nicht
gesondert berechnet, um keine implizite Handelsrichtung in die Zieldefinition
selbst einzubauen (die Aufgabenstellung verbietet explizit die Umwandlung in
LONG/SHORT-Signale).

`horizon_bars` wird vom Aufrufer aus der Timeframe abgeleitet (siehe
`horizon_bars_for_timeframe`) -- diese Datei kennt selbst keine Timeframes.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

HORIZON_LABELS = ["1H", "4H", "12H", "24H", "48H", "7D"]
_HORIZON_HOURS = {"1H": 1, "4H": 4, "12H": 12, "24H": 24, "48H": 48, "7D": 168}

_TF_MINUTES = {"5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440}


def horizon_bars_for_timeframe(timeframe: str) -> dict[str, int]:
    """z.B. timeframe='15m' -> {'1H': 4, '4H': 16, '12H': 48, '24H': 96,
    '48H': 192, '7D': 672}. Rundet auf ganze Bars; Horizonte, die nicht
    ganzzahlig auf die Timeframe passen (z.B. 1H auf 4h-Kerzen), werden auf
    den naechstgelegenen ganzzahligen Bar-Wert gerundet, MINDESTENS 1 --
    nie 0 (ein Horizont von 0 Bars waere kein Forward-Return mehr)."""
    if timeframe not in _TF_MINUTES:
        raise ValueError(f"Unbekannte Timeframe '{timeframe}'")
    tf_minutes = _TF_MINUTES[timeframe]
    return {
        label: max(1, round(hours * 60 / tf_minutes))
        for label, hours in _HORIZON_HOURS.items()
    }


def compute_forward_return_targets(df: pd.DataFrame, horizon_bars: dict[str, int]) -> pd.DataFrame:
    """df: OHLC-DataFrame, aufsteigend sortiert. Fuer jeden Horizont in
    `horizon_bars`: forward_return, direction (+1/-1/0), abs_return, mfe,
    mae. Letzte `max(horizon_bars)` Bars sind zwangslaeufig NaN (kein
    vollstaendiger Horizont mehr verfuegbar) -- kein Wrap-Around, keine
    Fabrikation."""
    close = df["close"]
    high = df["high"]
    low = df["low"]

    out = {}
    for label, bars in horizon_bars.items():
        future_close = close.shift(-bars)
        forward_return = future_close / close - 1.0
        direction = np.sign(forward_return)

        # MFE/MAE: Max/Min von high/low ueber die naechsten `bars` Kerzen
        # (EXKLUSIVE der aktuellen Bar selbst), relativ zum aktuellen Close.
        mfe = _rolling_forward_extreme(high.to_numpy(), bars, "max") / close.to_numpy() - 1.0
        mae = _rolling_forward_extreme(low.to_numpy(), bars, "min") / close.to_numpy() - 1.0

        out[f"forward_return_{label}"] = forward_return
        out[f"direction_{label}"] = direction
        out[f"abs_return_{label}"] = forward_return.abs()
        out[f"mfe_{label}"] = pd.Series(mfe, index=df.index)
        out[f"mae_{label}"] = pd.Series(mae, index=df.index)

    return pd.DataFrame(out, index=df.index)


def _rolling_forward_extreme(values: np.ndarray, bars: int, mode: str) -> np.ndarray:
    """values[i+1 .. i+bars] Max/Min, NaN wenn das Fenster ueber das
    Datenende hinausragt."""
    n = len(values)
    out = np.full(n, np.nan)
    fn = np.max if mode == "max" else np.min
    for i in range(n - bars):
        window = values[i + 1 : i + 1 + bars]
        out[i] = fn(window)
    return out
