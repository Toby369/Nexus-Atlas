"""VWAP-Vector-Levels, wie Nexus sie bereits nachbaut (lib/tradingIndicatorsContext.ts,
lib/swingDetection.ts): Tag-VWAP (seit 00:00 UTC), Wochen-VWAP (seit Montag 00:00 UTC),
Monats-VWAP, sowie je ein VWAP seit dem letzten bestaetigten 1H-Swing-Hoch und
-Tief (fraktal, Lookback 20 wie Mo's swingPivLen). Quelle hlc3 x Volumen auf
15m-Kerzen.

Look-Ahead: jeder Level-Wert gilt am SCHLUSS der jeweiligen 15m-Kerze und nutzt nur
Kerzen bis einschliesslich dieser. Ein Swing gilt erst als bekannt, wenn die
20. Kerze nach ihm geschlossen hat.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

SWING_LOOKBACK = 20


def fractal_swings(high: np.ndarray, low: np.ndarray, lookback: int) -> tuple[np.ndarray, np.ndarray]:
    """detectFractalSwings() aus lib/swingDetection.ts: strikt hoeher/tiefer als
    jede der `lookback` Kerzen davor UND danach."""
    n = len(high)
    is_hi = np.zeros(n, dtype=bool)
    is_lo = np.zeros(n, dtype=bool)
    win = 2 * lookback + 1
    if n < win:
        return is_hi, is_lo
    from numpy.lib.stride_tricks import sliding_window_view

    hw = sliding_window_view(high, win)
    lw = sliding_window_view(low, win)
    centre_h = high[lookback : n - lookback]
    centre_l = low[lookback : n - lookback]
    # Zentrum ist Maximum UND kommt nur einmal vor (alle anderen strikt kleiner)
    is_hi[lookback : n - lookback] = (hw.max(axis=1) == centre_h) & ((hw == centre_h[:, None]).sum(axis=1) == 1)
    is_lo[lookback : n - lookback] = (lw.min(axis=1) == centre_l) & ((lw == centre_l[:, None]).sum(axis=1) == 1)
    return is_hi, is_lo


def vwap_levels(f15: pd.DataFrame, f1h: pd.DataFrame) -> pd.DataFrame:
    """Index = close_time der 15m-Kerze. Spalten: day, week, month, swing_hi, swing_lo."""
    tp = (f15["high"] + f15["low"] + f15["close"]) / 3.0
    v = f15["volume"].fillna(0.0)
    pv = tp * v
    close_time = f15.index + pd.Timedelta(minutes=15)
    out = pd.DataFrame(index=close_time)
    opens = f15.index
    keys = {
        "day": opens.floor("D"),
        "week": (opens - pd.to_timedelta(opens.dayofweek, unit="D")).floor("D"),
        "month": opens.to_period("M").to_timestamp().tz_localize("UTC") if opens.tz is None else opens.tz_convert(None).to_period("M").to_timestamp().tz_localize("UTC"),
    }
    for name, key in keys.items():
        g = pd.Series(np.asarray(key), index=f15.index)
        cpv = pv.groupby(g.values).cumsum()
        cv = v.groupby(g.values).cumsum()
        out[name] = (cpv / cv.replace(0, np.nan)).to_numpy()

    # Swing-verankerte VWAPs ueber globale Kumulativsummen
    cpv = pv.cumsum().to_numpy()
    cv = v.cumsum().to_numpy()
    hi, lo = fractal_swings(f1h["high"].to_numpy(), f1h["low"].to_numpy(), SWING_LOOKBACK)
    confirm = f1h.index + pd.Timedelta(hours=SWING_LOOKBACK + 1)  # Schluss der 20. Folgekerze
    for name, mask in (("swing_hi", hi), ("swing_lo", lo)):
        anchors = pd.DataFrame({"known": confirm[mask].as_unit("ns"), "anchor": f1h.index[mask].as_unit("ns")})
        left = pd.DataFrame({"known": close_time.as_unit("ns")})
        m = pd.merge_asof(left, anchors, on="known", direction="backward")
        # Index der ersten 15m-Kerze ab dem Anker
        a_idx = np.searchsorted(f15.index.asi8, m["anchor"].astype("int64").to_numpy())
        valid = m["anchor"].notna().to_numpy()
        t_idx = np.arange(len(f15))
        base_pv = np.where(a_idx > 0, cpv[np.clip(a_idx - 1, 0, None)], 0.0)
        base_v = np.where(a_idx > 0, cv[np.clip(a_idx - 1, 0, None)], 0.0)
        num = cpv - base_pv
        den = cv - base_v
        val = np.where(valid & (a_idx <= t_idx) & (den > 0), num / np.where(den > 0, den, 1), np.nan)
        out[name] = val
    return out


def nearest_level(levels_row: np.ndarray, price: float, direction: int, reach: float) -> float | None:
    """Long: hoechstes Level UNTER dem Kurs, Short: tiefstes Level UEBER dem Kurs,
    jeweils hoechstens `reach` (relativ) entfernt. None = kein Level in Reichweite."""
    lv = levels_row[~np.isnan(levels_row)]
    if direction > 0:
        cand = lv[(lv < price) & (lv >= price * (1 - reach))]
        return float(cand.max()) if cand.size else None
    cand = lv[(lv > price) & (lv <= price * (1 + reach))]
    return float(cand.min()) if cand.size else None
