"""Feature-Aufbau pro Timeframe und Erzeugung der Setups.

Drei Rollen (siehe config.TIMEFRAME_SETS): `high` (Trend + Volume Profile),
`mid` (Momentum + CVD) und `base` (Sweep/CHoCH-Trigger, Simulation).

Look-Ahead-Regel (zentral fuer alles hier): Ein Wert einer h-Kerze mit
Open-Time T ist erst zum Schlusszeitpunkt T + h bekannt. Eine Entscheidung
auf der Base-Kerze mit Open-Time t faellt zu deren Schluss t + b. Die
Ausrichtung (`align_to_base`) nimmt fuer jede Base-Kerze den letzten Wert
mit T + h <= t + b -- also nur geschlossene hoehere Kerzen.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import StrategyParams
from indicators import atr, macd_hist, pivot_high, pivot_low, rsi
from volume_profile import profile_levels

def align_to_base(htf: pd.DataFrame, rule: str, base_index: pd.DatetimeIndex, base_rule: str) -> pd.DataFrame:
    """Richtet HTF-Features (Index = Open-Time) auf die Base-Kerzen aus."""
    known_at = htf.copy()
    known_at.index = known_at.index + pd.Timedelta(rule)
    decision = pd.DataFrame(index=base_index + pd.Timedelta(base_rule))
    merged = pd.merge_asof(
        decision, known_at, left_index=True, right_index=True, direction="backward"
    )
    merged.index = base_index
    return merged


def _last_two(confirmed: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Fuer jede Kerze: letzter und vorletzter bis dahin bestaetigter Pivot."""
    last = np.full(len(confirmed), np.nan)
    prev = np.full(len(confirmed), np.nan)
    a = b = np.nan
    for i, v in enumerate(confirmed):
        if not np.isnan(v):
            b, a = a, v
        last[i], prev[i] = a, b
    return last, prev


def features_high(perp_15m: pd.DataFrame, perp_high: pd.DataFrame, high_rule: str, p: StrategyParams) -> pd.DataFrame:
    out = pd.DataFrame(index=perp_high.index)
    ph = pivot_high(perp_high["high"].to_numpy(), p.pivot_len_high, p.pivot_len_high)
    pl = pivot_low(perp_high["low"].to_numpy(), p.pivot_len_high, p.pivot_len_high)
    last_ph, prev_ph = _last_two(ph)
    last_pl, prev_pl = _last_two(pl)
    close = perp_high["close"].to_numpy()
    bull = (last_ph > prev_ph) & (last_pl > prev_pl) & (close > last_pl)
    bear = (last_ph < prev_ph) & (last_pl < prev_pl) & (close < last_ph)
    out["trend"] = np.where(bull, 1, np.where(bear, -1, 0))
    out["last_ph"] = last_ph
    out["last_pl"] = last_pl
    out["atr"] = atr(perp_high).to_numpy()

    # Volume Profile ueber die letzten vp_lookback_high Kerzen, immer aus 15m.
    t15 = perp_15m.index
    lows, highs, vols = (perp_15m[c].to_numpy() for c in ("low", "high", "volume"))
    poc = np.full(len(perp_high), np.nan)
    vah = np.full(len(perp_high), np.nan)
    val = np.full(len(perp_high), np.nan)
    bar_len = pd.Timedelta(high_rule)
    for i in range(p.vp_lookback_high - 1, len(perp_high)):
        start = perp_high.index[i - p.vp_lookback_high + 1]
        end = perp_high.index[i] + bar_len
        a = t15.searchsorted(start, side="left")
        b = t15.searchsorted(end, side="left")
        if b - a < 10:
            continue
        poc[i], vah[i], val[i] = profile_levels(
            lows[a:b], highs[a:b], vols[a:b], p.vp_bins, p.vp_value_area
        )
    out["poc"], out["vah"], out["val"] = poc, vah, val
    return out


def features_mid(perp_mid: pd.DataFrame, spot_mid: pd.DataFrame, p: StrategyParams) -> pd.DataFrame:
    out = pd.DataFrame(index=perp_mid.index)
    r = rsi(perp_mid["close"], p.rsi_len)
    out["rsi_min"] = r.rolling(p.rsi_reset_lookback).min()
    out["rsi_max"] = r.rolling(p.rsi_reset_lookback).max()
    hist = macd_hist(perp_mid["close"])
    out["macd_up"] = hist > hist.shift()
    out["macd_down"] = hist < hist.shift()

    w = p.cvd_window_mid
    perp_ratio = perp_mid["delta"].rolling(w).sum() / perp_mid["volume"].rolling(w).sum()
    spot = spot_mid.reindex(perp_mid.index)
    spot_ratio = spot["delta"].rolling(w).sum() / spot["volume"].rolling(w).sum()
    out["perp_ratio"] = perp_ratio
    out["spot_ratio"] = spot_ratio
    return out


@dataclass
class Setup:
    bar: int  # Index der Base-Signalkerze (Einstieg zum Open der naechsten)
    direction: int  # +1 long, -1 short
    stop: float
    trend: bool
    zone: bool
    momentum: bool
    cvd: bool
    vol_spike: bool
    targets: tuple[float, ...]  # Level des hohen Timeframes als TP-Kandidaten


def find_setups(
    base: pd.DataFrame, f_high: pd.DataFrame, f_mid: pd.DataFrame, rules: dict[str, str], p: StrategyParams
) -> list[Setup]:
    """Trigger: Sweep eines bestaetigten Base-Pivots (Wick drueber/drunter,
    Close zurueck), danach CHoCH = Close jenseits des letzten bestaetigten
    Gegen-Pivots innerhalb von `sweep_valid_bars`. Alle Filter werden nur als
    Flags gespeichert, damit jede Variante dieselben Rohsignale sieht."""
    o, h, l, c, v = (base[k].to_numpy() for k in ("open", "high", "low", "close", "volume"))
    n = len(c)
    atr_base = atr(base).to_numpy()
    vol_ma = pd.Series(v).rolling(p.vol_spike_len).mean().shift().to_numpy()
    last_ph15, _ = _last_two(pivot_high(h, p.pivot_len_base, p.pivot_len_base))
    last_pl15, _ = _last_two(pivot_low(l, p.pivot_len_base, p.pivot_len_base))

    a4 = align_to_base(f_high, rules["high"], base.index, rules["base"])
    a1 = align_to_base(f_mid, rules["mid"], base.index, rules["base"])
    trend = a4["trend"].to_numpy()
    poc, vah, val = a4["poc"].to_numpy(), a4["vah"].to_numpy(), a4["val"].to_numpy()
    atr4 = a4["atr"].to_numpy()
    ph4, pl4 = a4["last_ph"].to_numpy(), a4["last_pl"].to_numpy()
    rsi_min, rsi_max = a1["rsi_min"].to_numpy(), a1["rsi_max"].to_numpy()
    macd_up = a1["macd_up"].fillna(False).to_numpy(dtype=bool)
    macd_down = a1["macd_down"].fillna(False).to_numpy(dtype=bool)
    spot_r, perp_r = a1["spot_ratio"].to_numpy(), a1["perp_ratio"].to_numpy()

    def in_zone(price: float, levels: tuple[float, ...], width: float) -> bool:
        return any(abs(price - lv) <= width for lv in levels if not np.isnan(lv))

    setups: list[Setup] = []
    # Aktiver Sweep je Richtung: (Sweep-Bar, Extrem, CHoCH-Level, Zone, VolSpike)
    active: dict[int, tuple[int, float, float, bool, bool] | None] = {1: None, -1: None}

    for i in range(1, n - 1):
        if np.isnan(atr4[i]) or np.isnan(poc[i]):
            continue
        width = p.zone_atr_mult * atr4[i]
        spike = bool(v[i] >= p.vol_spike_mult * vol_ma[i]) if not np.isnan(vol_ma[i]) else False

        # --- Sweeps registrieren (Pivot muss VOR dieser Kerze bestaetigt sein) ---
        pl_prev, ph_prev = last_pl15[i - 1], last_ph15[i - 1]
        if not np.isnan(pl_prev) and l[i] < pl_prev < c[i] and not np.isnan(ph_prev):
            active[1] = (i, l[i], ph_prev, in_zone(l[i], (poc[i], val[i]), width), spike)
        if not np.isnan(ph_prev) and h[i] > ph_prev > c[i] and not np.isnan(pl_prev):
            active[-1] = (i, h[i], pl_prev, in_zone(h[i], (poc[i], vah[i]), width), spike)

        for d in (1, -1):
            st = active[d]
            if st is None or st[0] == i:
                continue
            sweep_bar, extreme, choch, zone, vspike = st
            extreme = min(extreme, l[i]) if d == 1 else max(extreme, h[i])
            active[d] = (sweep_bar, extreme, choch, zone, vspike)
            if i - sweep_bar > p.sweep_valid_bars:
                active[d] = None
                continue
            broke = c[i] > choch if d == 1 else c[i] < choch
            if not broke:
                continue
            active[d] = None
            stop = extreme - d * p.sl_atr_buffer * atr_base[i]
            if d == 1:
                mom = bool(rsi_min[i] <= p.rsi_reset_long and macd_up[i])
                flow = bool(spot_r[i] > 0 and perp_r[i] < spot_r[i])
                targets = (poc[i], vah[i], ph4[i])
            else:
                mom = bool(rsi_max[i] >= p.rsi_reset_short and macd_down[i])
                flow = bool(spot_r[i] < 0 and perp_r[i] > spot_r[i])
                targets = (poc[i], val[i], pl4[i])
            setups.append(
                Setup(
                    bar=i, direction=d, stop=float(stop), trend=bool(trend[i] == d), zone=zone,
                    momentum=mom, cvd=flow, vol_spike=vspike,
                    targets=tuple(float(t) for t in targets if not np.isnan(t)),
                )
            )
    return setups
