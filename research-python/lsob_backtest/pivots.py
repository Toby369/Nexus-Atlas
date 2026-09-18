"""Pivot-High/Low-Erkennung, 1:1 aequivalent zu Pine's ta.pivothigh/ta.pivotlow.

WICHTIG (Look-Ahead-Sicherheit): ta.pivothigh(high, left, right) bestaetigt
einen Pivot an Bar i erst NACHDEM `right` weitere Bars vergangen sind (man
muss die Zukunft von Bar i kennen, um zu wissen, dass sie ein lokales Extrem
war). Das Ergebnis wird in Pine daher erst auf Bar (i + right) sichtbar
("not na"). Diese Verzoegerung ist von Toby selbst als Kritikpunkt genannt
("Pivot-Erkennung ist nachlaufend") -- hier bewusst exakt nachgebildet,
NICHT wegoptimiert, sonst waere der Backtest optimistischer als das
Original-Skript live waere.
"""

import numpy as np


def _pivot(values: np.ndarray, left: int, right: int, mode: str) -> np.ndarray:
    """Liefert ein Array derselben Laenge wie `values`; an Index (i+right)
    steht der Pivot-Wert von Bar i, falls Bar i strikt hoechster/niedrigster
    Punkt im Fenster [i-left, i+right] war -- sonst NaN.
    """
    n = len(values)
    revealed = np.full(n, np.nan)
    cmp = np.greater if mode == "high" else np.less

    for i in range(left, n - right):
        center = values[i]
        left_window = values[i - left : i]
        right_window = values[i + 1 : i + 1 + right]
        # Strikte Ungleichheit auf beiden Seiten (Pine-Konvention: ein
        # gleich hoher Nachbar verhindert die Pivot-Bestaetigung).
        if np.all(cmp(center, left_window)) and np.all(cmp(center, right_window)):
            revealed[i + right] = center

    return revealed


def pivot_high(high: np.ndarray, left: int, right: int) -> np.ndarray:
    return _pivot(high, left, right, "high")


def pivot_low(low: np.ndarray, left: int, right: int) -> np.ndarray:
    return _pivot(low, left, right, "low")
