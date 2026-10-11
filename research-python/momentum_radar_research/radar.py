"""Python-Nachbau der Signal-Logik von Mo's Momentum Radar
(docs/tradingview/mos-momentum-radar.pine, Rechenwerk unveraendert gegenueber
dem Original unter docs/tradingview/reference/). Nur, was der Backtest braucht:
Welle, Punkte (klein/gross), Geldfluss-Vorzeichen, Zonen-Zustand der hoeheren
Zeitebenen und die beiden optionalen 4h-Trendfilter (Fix F7).

Alle Konstanten stammen 1:1 aus dem RECHENWERK-Block des Pine-Skripts -- keine
eigene Kalibrierung.

Repaint-/Look-Ahead-Semantik (wie im Pine-Skript, request.security mit [1] +
lookahead_on): eine hoehere Zeitebene ist auf einer Chart-Kerze erst sichtbar,
wenn ihre Kerze VOR dem Oeffnen dieser Chart-Kerze geschlossen hat
(htf close_time <= chart open_time). Das ist eine Chart-Kerze spaeter als
`wave_anchor_research/mtf_join.confirmed_asof_join` (dort htf close_time <=
chart close_time) -- beides ist look-ahead-sicher, hier wird bewusst die
Pine-Semantik des Radars nachgebildet.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

# --- RECHENWERK (1:1 aus dem Pine-Skript) ---
WT_CH = 9
WT_AVG = 12
WT_SIG = 3
OB_LVL = 50.0
OS_LVL = -50.0
NEAR_PCT = 70.0
STR_PCT = 0.6
MF_LEN = 60
BOS_LEN = 5
EMA_LEN = 50

TF_SECONDS = {"15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
# Zeitebenen, die fuer die Punktstaerke mitzaehlen koennen (Default-Einstellungen:
# W aus und erst ab Tageschart automatisch an, 15m/5m "nur anzeigen").
COUNTED_HTFS = ("1d", "4h", "1h")


def load_ohlcv(path: str) -> pd.DataFrame:
    """CSV mit Spalten ts (open_time, Unix-Sekunden), open, high, low, close, volume."""
    df = pd.read_csv(path)
    df.index = pd.DatetimeIndex(pd.to_datetime(df.pop("ts"), unit="s", utc=True)).as_unit("ns")
    df.index.name = "open_time"
    return df.sort_index()


def ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=length, adjust=False, min_periods=length).mean()


def wavetrend(df: pd.DataFrame) -> pd.DataFrame:
    """f_wt() im Pine-Skript."""
    src = (df["high"] + df["low"] + df["close"]) / 3.0
    esa = ema(src, WT_CH)
    dev = ema((src - esa).abs(), WT_CH)
    ci = ((src - esa) / (0.015 * dev)).where(dev != 0, 0.0)
    w1 = ema(ci, WT_AVG)
    w2 = w1.rolling(WT_SIG, min_periods=WT_SIG).mean()
    return pd.DataFrame({"wt1": w1, "wt2": w2}, index=df.index)


def money_flow_raw(df: pd.DataFrame) -> pd.Series:
    """Rohwert von f_mf(). Die Selbstskalierung (raw / ref * MF_TARGET) teilt durch
    eine positive Groesse und aendert das Vorzeichen nicht -- fuer die Punktstaerke
    zaehlt nur `mf > 0` bzw. `mf < 0`, deshalb reicht der Rohwert."""
    r = df["high"] - df["low"]
    v = df["volume"].fillna(0.0)
    pos = ((df["close"] - df["open"]) / r).where(r != 0, 0.0)
    num = (pos * v).rolling(MF_LEN, min_periods=MF_LEN).mean()
    den = v.rolling(MF_LEN, min_periods=MF_LEN).mean()
    alt = pos.rolling(MF_LEN, min_periods=MF_LEN).mean()
    return (num / den).where(den != 0, alt)


def zone_state(w: pd.Series) -> pd.Series:
    """f_state(): +1 = (fast) Long-Zone, -1 = (fast) Short-Zone, 0 = neutral/na."""
    near_lo = OS_LVL * NEAR_PCT / 100
    near_hi = OB_LVL * NEAR_PCT / 100
    out = np.where(w <= OS_LVL, 1, np.where(w >= OB_LVL, -1, np.where(w <= near_lo, 1, np.where(w >= near_hi, -1, 0))))
    return pd.Series(np.where(w.isna(), 0, out), index=w.index, dtype=int)


def structure_4h(df4: pd.DataFrame) -> pd.DataFrame:
    """f_piv() + BOS-Zustandsmaschine, auf 4h-Kerzen-Ebene. Werte gelten ab dem
    Schluss der jeweiligen 4h-Kerze. emaDir: close > EMA50 ? 1 : -1."""
    high = df4["high"].to_numpy()
    low = df4["low"].to_numpy()
    close = df4["close"].to_numpy()
    n = len(df4)
    e = ema(df4["close"], EMA_LEN).to_numpy()
    ema_dir = np.where(np.isnan(e), 0, np.where(close > e, 1, -1))
    bos_dir = np.zeros(n, dtype=int)
    lph = lpl = np.nan
    state = 0
    L = BOS_LEN
    for j in range(n):
        p = j - L  # Pivot-Kandidat, bestaetigt an Kerze j
        if p - L >= 0:
            win_h = high[p - L : j + 1]
            win_l = low[p - L : j + 1]
            # ta.pivothigh: Kandidat strikt groesser als die linken, >= ... Pine nutzt
            # "groesser als alle anderen im Fenster"; bei Gleichstand kein Pivot.
            if high[p] == win_h.max() and (win_h == high[p]).sum() == 1:
                lph = high[p]
            if low[p] == win_l.min() and (win_l == low[p]).sum() == 1:
                lpl = low[p]
        prev_close = close[j - 1] if j > 0 else np.nan
        broke_up = not math.isnan(lph) and close[j] > lph and (math.isnan(prev_close) or prev_close <= lph)
        broke_dn = not math.isnan(lpl) and close[j] < lpl and (math.isnan(prev_close) or prev_close >= lpl)
        if broke_up:
            state = 1
        elif broke_dn:
            state = -1
        bos_dir[j] = state
    return pd.DataFrame({"ema_dir": ema_dir, "bos_dir": bos_dir}, index=df4.index)


def htf_on_chart(chart_index: pd.DatetimeIndex, chart_tf: str, htf_df: pd.DataFrame, htf_tf: str) -> pd.DataFrame:
    """Wert der hoeheren Zeitebene, wie ihn das Pine-Skript auf jeder Chart-Kerze
    sieht. Hoehere Zeitebene: letzte HTF-Kerze mit close_time <= Chart-open_time.
    Gleiche Zeitebene (z. B. Struktur 4h im 4h-Chart, f_off = 0): Wert der eigenen
    Kerze."""
    if TF_SECONDS[htf_tf] <= TF_SECONDS[chart_tf]:
        return htf_df.reindex(chart_index)
    htf = htf_df.copy()
    htf["__known__"] = (htf.index + pd.Timedelta(seconds=TF_SECONDS[htf_tf])).as_unit("ns")
    left = pd.DataFrame({"__known__": chart_index.as_unit("ns")})
    merged = pd.merge_asof(left, htf.reset_index(drop=True).sort_values("__known__"), on="__known__", direction="backward")
    merged.index = chart_index
    return merged.drop(columns="__known__")


def radar_signals(chart_tf: str, frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Signale der Chart-Zeitebene, Default-Einstellungen des Radars.

    Spalten: wt1, wt2, mf_raw, bull_dot, bear_dot, bull_big, bear_big,
    ema_dir_4h, bos_dir_4h, n_count, str_need, bull_cnt, bear_cnt.
    Ein Punkt gilt am Schluss seiner Kerze (barstate.isconfirmed)."""
    df = frames[chart_tf]
    out = wavetrend(df)
    w1, w2 = out["wt1"], out["wt2"]
    cross_up = (w1 > w2) & (w1.shift(1) <= w2.shift(1))
    cross_dn = (w1 < w2) & (w1.shift(1) >= w2.shift(1))
    out["bull_dot"] = cross_up & (w1 <= OS_LVL)  # DOT_LOOK = 1
    out["bear_dot"] = cross_dn & (w1 >= OB_LVL)
    out["mf_raw"] = money_flow_raw(df)

    above = [tf for tf in COUNTED_HTFS if TF_SECONDS[tf] > TF_SECONDS[chart_tf]]
    bull_cnt = pd.Series(0, index=df.index)
    bear_cnt = pd.Series(0, index=df.index)
    for tf in above:
        st = zone_state(wavetrend(frames[tf])["wt1"]).to_frame("dir")
        d = htf_on_chart(df.index, chart_tf, st, tf)["dir"].fillna(0).astype(int)
        out[f"dir_{tf}"] = d
        bull_cnt += (d > 0).astype(int)
        bear_cnt += (d < 0).astype(int)
    n_count = len(above)
    str_need = max(1, math.ceil((n_count + 1) * STR_PCT))
    bull_str = bull_cnt + (out["mf_raw"] > 0).astype(int)
    bear_str = bear_cnt + (out["mf_raw"] < 0).astype(int)
    out["bull_big"] = out["bull_dot"] & (n_count > 0) & (bull_str >= str_need)
    out["bear_big"] = out["bear_dot"] & (n_count > 0) & (bear_str >= str_need)

    s4 = htf_on_chart(df.index, chart_tf, structure_4h(frames["4h"]), "4h")
    out["ema_dir_4h"] = s4["ema_dir"].fillna(0).astype(int)
    out["bos_dir_4h"] = s4["bos_dir"].fillna(0).astype(int)
    out["n_count"] = n_count
    out["str_need"] = str_need
    out["bull_cnt"] = bull_cnt
    out["bear_cnt"] = bear_cnt
    return out


# --- Sekundaere Signale (Plan H4-H6) ---
EXT_LOOK = 4
OV_LVL = 100.0
DIV_MAX = 80
DIV_LOOK = 5
MF_NORM = 200
MF_TARGET = 22.0
MFD_LEN = 5
MFD_MIN = 5
MFD_MAX = 80


def money_flow_scaled(df: pd.DataFrame) -> pd.Series:
    """Vollstaendiges f_mf(0) inkl. Selbstskalierung (fuer Vergleiche ueber die Zeit,
    z. B. die Geldfluss-Divergenz)."""
    raw = money_flow_raw(df)
    absraw = raw.abs()
    ref_sma = absraw.rolling(MF_NORM, min_periods=MF_NORM).mean()
    ref_cum = absraw.expanding().mean()
    ref = ref_sma.where(ref_sma.notna(), ref_cum)
    return (raw / ref * MF_TARGET).where(ref.notna() & (ref != 0), 0.0)


def secondary_signals(df: pd.DataFrame, sig: pd.DataFrame) -> pd.DataFrame:
    """Raute (extrLo/extrHi), Divergenz auf der Welle (divBull/divBear, Nexus-Fix-
    Version = Original fuer die Chart-Zeitebene) und Geldfluss-Divergenz (Fix F6).
    Alle Signale gelten am Schluss der Kerze, an der sie im Pine-Skript feuern."""
    w1, w2 = sig["wt1"], sig["wt2"]
    cross_up = (w1 > w2) & (w1.shift(1) <= w2.shift(1))
    cross_dn = (w1 < w2) & (w1.shift(1) >= w2.shift(1))
    out = pd.DataFrame(index=df.index)
    out["raute_long"] = cross_up & (w1.rolling(EXT_LOOK).min() <= -OV_LVL)
    out["raute_short"] = cross_dn & (w1.rolling(EXT_LOOK).max() >= OV_LVL)

    px_hi = df["high"].rolling(DIV_LOOK).max().to_numpy()
    px_lo = df["low"].rolling(DIV_LOOK).min().to_numpy()
    wt = w1.to_numpy()
    bull_dot = sig["bull_dot"].to_numpy()
    bear_dot = sig["bear_dot"].to_numpy()
    n = len(df)
    div_bull = np.zeros(n, dtype=bool)
    div_bear = np.zeros(n, dtype=bool)
    pb = pw = pp = None
    qb = qw = qp = None
    for i in range(n):
        if bear_dot[i]:
            if pb is not None and i - pb <= DIV_MAX and px_hi[i] > pp and wt[i] < pw:
                div_bear[i] = True
            pb, pw, pp = i, wt[i], px_hi[i]
        if bull_dot[i]:
            if qb is not None and i - qb <= DIV_MAX and px_lo[i] < qp and wt[i] > qw:
                div_bull[i] = True
            qb, qw, qp = i, wt[i], px_lo[i]
    out["div_long"] = div_bull
    out["div_short"] = div_bear

    from vwap_vector import fractal_swings

    mf = money_flow_scaled(df).to_numpy()
    is_hi, is_lo = fractal_swings(df["high"].to_numpy(), df["low"].to_numpy(), MFD_LEN)
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    mfd_bull = np.zeros(n, dtype=bool)
    mfd_bear = np.zeros(n, dtype=bool)
    prev_l = prev_h = None
    for p in range(n - MFD_LEN):
        i = p + MFD_LEN  # Bestaetigungskerze
        if is_lo[p]:
            if prev_l is not None and MFD_MIN <= p - prev_l <= MFD_MAX and low[p] < low[prev_l] and mf[p] > mf[prev_l]:
                mfd_bull[i] = True
            prev_l = p
        if is_hi[p]:
            if prev_h is not None and MFD_MIN <= p - prev_h <= MFD_MAX and high[p] > high[prev_h] and mf[p] < mf[prev_h]:
                mfd_bear[i] = True
            prev_h = p
    out["mfdiv_long"] = mfd_bull
    out["mfdiv_short"] = mfd_bear
    return out
