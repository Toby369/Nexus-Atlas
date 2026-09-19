"""Pivot-High/Low-Erkennung, 1:1 aequivalent zu Pine's ta.pivothigh/ta.pivotlow.
Identisch zu den anderen Projekten dieser Codebasis (lsob_backtest,
oms_backtest, avwap_pivot_setup) -- bewusst dupliziert statt cross-projekt
importiert.

Anders als bei avwap_pivot_setup (Pivots auf CLOSE) wird hier -- exakt nach
Tobys Spezifikation ("ta.pivothigh(high, N, N)" / "ta.pivotlow(low, N, N)")
-- `pivot_high` auf das HIGH-Array und `pivot_low` auf das LOW-Array
angewendet, siehe elliott_wave_engine.py.
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
