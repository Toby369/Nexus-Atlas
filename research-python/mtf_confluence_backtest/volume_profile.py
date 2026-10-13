"""Rollierendes Volume Profile (POC / VAH / VAL).

Das Volumen jeder 15m-Kerze wird gleichmaessig auf die Preis-Bins zwischen
ihrem Low und High verteilt (statt komplett auf einen Preis gelegt) -- die
gaengige Naeherung, wenn keine Trade-Daten vorliegen.
"""

from __future__ import annotations

import numpy as np


def profile_levels(
    low: np.ndarray, high: np.ndarray, volume: np.ndarray, bins: int, value_area: float
) -> tuple[float, float, float]:
    """Gibt (poc, vah, val) fuer die uebergebenen Kerzen zurueck."""
    lo, hi = float(np.min(low)), float(np.max(high))
    if hi <= lo:
        return lo, lo, lo
    edges = np.linspace(lo, hi, bins + 1)
    width = edges[1] - edges[0]
    centers = edges[:-1] + width / 2

    # Anteil jeder Kerze an jedem Bin: Ueberlappung [low, high] mit dem Bin.
    overlap = np.clip(
        np.minimum(high[:, None], edges[None, 1:]) - np.maximum(low[:, None], edges[None, :-1]), 0, None
    )
    span = high - low
    weights = np.where(span[:, None] > 0, overlap / np.where(span > 0, span, 1)[:, None], 0.0)
    # Kerzen ohne Spanne (high == low) landen komplett in ihrem Bin.
    flat = span <= 0
    if flat.any():
        idx = np.clip(((low[flat] - lo) / width).astype(int), 0, bins - 1)
        weights[np.nonzero(flat)[0], idx] = 1.0
    hist = (weights * volume[:, None]).sum(axis=0)

    poc_idx = int(np.argmax(hist))
    target = hist.sum() * value_area
    lo_idx = hi_idx = poc_idx
    acc = hist[poc_idx]
    # Value Area: vom POC aus jeweils den volumenstaerkeren Nachbarn anfuegen.
    while acc < target and (lo_idx > 0 or hi_idx < bins - 1):
        up = hist[hi_idx + 1] if hi_idx < bins - 1 else -1.0
        down = hist[lo_idx - 1] if lo_idx > 0 else -1.0
        if up >= down:
            hi_idx += 1
            acc += up
        else:
            lo_idx -= 1
            acc += down
    return float(centers[poc_idx]), float(edges[hi_idx + 1]), float(edges[lo_idx])
