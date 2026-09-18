"""Pivot-High/Low-Erkennung, 1:1 aequivalent zu Pine's ta.pivothigh/ta.pivotlow.
Identisch zu research-python/lsob_backtest/pivots.py -- bewusst dupliziert
statt cross-projekt importiert, damit dieses Backtest-Projekt eigenstaendig
lauffaehig bleibt (gleiche Konvention wie im LSOB-Projekt: kleine, reine
Funktionen werden je Projekt eigenstaendig gehalten statt geteilt).

WICHTIG (Look-Ahead-Sicherheit): ta.pivothigh(werte, left, right) bestaetigt
einen Pivot an Bar i erst NACHDEM `right` weitere Bars vergangen sind. Das
Ergebnis wird in Pine daher erst auf Bar (i + right) sichtbar ("not na").
Bewusst exakt nachgebildet, nicht wegoptimiert.

Fuer die "Old Money Stack"-Strategie werden diese Funktionen auf den CLOSE-
Preis angewendet (nicht High/Low wie bei LSOB) -- siehe oms_engine.py,
Nutzer-Vorgabe: "ta.pivothigh(close, 2, 2)".
"""

import numpy as np


def _pivot(values: np.ndarray, left: int, right: int, mode: str) -> np.ndarray:
    n = len(values)
    revealed = np.full(n, np.nan)
    cmp = np.greater if mode == "high" else np.less

    for i in range(left, n - right):
        center = values[i]
        left_window = values[i - left : i]
        right_window = values[i + 1 : i + 1 + right]
        if np.all(cmp(center, left_window)) and np.all(cmp(center, right_window)):
            revealed[i + right] = center

    return revealed


def pivot_high(high: np.ndarray, left: int, right: int) -> np.ndarray:
    return _pivot(high, left, right, "high")


def pivot_low(low: np.ndarray, left: int, right: int) -> np.ndarray:
    return _pivot(low, left, right, "low")
