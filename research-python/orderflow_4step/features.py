"""Merkmale fuer das Orderflow-4-Schritte-Protokoll.

Alle Funktionen sind kausal: Der Wert einer Kerze haengt nur von Kerzen bis
einschliesslich dieser Kerze ab (bzw. explizit nur von Kerzen DAVOR, wo das
Protokoll das verlangt). Zeitstempel sind Kerzen-Eroeffnungszeiten (UTC);
ein Wert ist zum Kerzenschluss (open_time + Intervall) bekannt.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from orderflow_4step import config as C
from src.features.mean_reversion import distance_to_ma_zscore
from src.features.momentum import adx
from src.features.trend import linreg_trend
from src.features.volatility import atr, atr_ratio, bollinger_bands
from src.regime import classify_market_regime

BAR_15M = pd.Timedelta(minutes=15)


# --- Schritt 2: US-Session-Anker und VWAP -----------------------------------


def us_session_anchor(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Je Kerze der juengste Anker 09:30 New York (Mo-Fr) <= Kerzen-Eroeffnung, in UTC.

    Wird ueber naive Ortszeit gebaut, damit 09:30 auch an DST-Wechseltagen
    09:30 Wanduhrzeit bleibt.
    """
    local = index.tz_convert(C.US_TZ).tz_localize(None)
    day = local.normalize()
    anchor_offset = pd.Timedelta(hours=C.US_ANCHOR_HOUR, minutes=C.US_ANCHOR_MINUTE)
    anchor = day + anchor_offset
    anchor = anchor.where(local >= anchor, anchor - pd.Timedelta(days=1))
    weekday = anchor.weekday
    # Samstag -> Freitag (1 Tag zurueck), Sonntag -> Freitag (2 Tage zurueck)
    back = np.where(weekday == 5, 1, np.where(weekday == 6, 2, 0))
    anchor = anchor - pd.to_timedelta(back, unit="D")
    return pd.DatetimeIndex(anchor).tz_localize(C.US_TZ).tz_convert("UTC")


def next_us_anchor_after(ts: pd.Timestamp) -> pd.Timestamp:
    """Erster Anker 09:30 New York (Mo-Fr) strikt nach `ts`."""
    local = ts.tz_convert(C.US_TZ).tz_localize(None)
    day = local.normalize()
    anchor_offset = pd.Timedelta(hours=C.US_ANCHOR_HOUR, minutes=C.US_ANCHOR_MINUTE)
    candidate = day + anchor_offset
    if candidate <= local:
        candidate += pd.Timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate += pd.Timedelta(days=1)
    return candidate.tz_localize(C.US_TZ).tz_convert("UTC")


def session_vwap(df15: pd.DataFrame) -> pd.DataFrame:
    """VWAP, volumengewichtete Standardabweichung und Kerzenzahl seit dem US-Anker.

    Enthaelt die aktuelle Kerze (bekannt zu ihrem Schluss).
    """
    anchor = us_session_anchor(df15.index)
    tp = (df15["high"] + df15["low"] + df15["close"]) / 3.0
    v = df15["volume"]
    frame = pd.DataFrame({"anchor": anchor, "v": v.values, "pv": (tp * v).values, "pv2": (tp * tp * v).values},
                         index=df15.index)
    grouped = frame.groupby("anchor", sort=False)
    cum_v = grouped["v"].cumsum()
    cum_pv = grouped["pv"].cumsum()
    cum_pv2 = grouped["pv2"].cumsum()
    vwap = cum_pv / cum_v
    var = (cum_pv2 / cum_v - vwap * vwap).clip(lower=0.0)
    bars = grouped.cumcount() + 1
    out = pd.DataFrame({"vwap": vwap, "vwap_sigma": np.sqrt(var), "vwap_bars": bars}, index=df15.index)
    out.loc[cum_v <= 0, ["vwap", "vwap_sigma"]] = np.nan
    return out


# --- Schritt 2: 24h-Volumenprofil -------------------------------------------


def profile_from_window(highs: np.ndarray, lows: np.ndarray, volumes: np.ndarray, bucket: float
                        ) -> tuple[float, float, float]:
    """POC (Bucket-Mitte), VAL, VAH fuer ein Kerzenfenster.

    Bucket k deckt [k*bucket, (k+1)*bucket) ab. Jede Kerze verteilt ihr Volumen
    zu gleichen Teilen auf alle Buckets von floor(low/bucket) bis
    floor(high/bucket). POC bei Gleichstand: tiefster Preis. Value Area: vom
    POC aus den volumenstaerkeren Nachbarn hinzufuegen (bei Gleichstand den
    oberen), bis >= 70 % erreicht sind.
    """
    lo_idx = np.floor(lows / bucket).astype(np.int64)
    hi_idx = np.floor(highs / bucket).astype(np.int64)
    base = lo_idx.min()
    n_buckets = int(hi_idx.max() - base + 1)
    profile = np.zeros(n_buckets + 1)
    share = volumes / (hi_idx - lo_idx + 1)
    # Differenzen-Array: +share am Start, -share hinter dem Ende, dann kumulieren
    np.add.at(profile, lo_idx - base, share)
    np.add.at(profile, hi_idx - base + 1, -share)
    profile = np.cumsum(profile)[:n_buckets]
    total = profile.sum()
    poc = int(np.argmax(profile))
    lo, hi = poc, poc
    acc = profile[poc]
    target = C.VALUE_AREA_SHARE * total
    while acc < target and (lo > 0 or hi < n_buckets - 1):
        below = profile[lo - 1] if lo > 0 else -1.0
        above = profile[hi + 1] if hi < n_buckets - 1 else -1.0
        if above >= below:
            hi += 1
            acc += above
        else:
            lo -= 1
            acc += below
    poc_price = (base + poc + 0.5) * bucket
    val = (base + lo) * bucket
    vah = (base + hi + 1) * bucket
    return poc_price, val, vah


def volume_profile(df15: pd.DataFrame, positions: np.ndarray | None = None) -> pd.DataFrame:
    """POC/VAL/VAH je Kerze i aus den PROFILE_BARS Kerzen VOR i (i selbst nicht enthalten).

    `positions`: nur fuer diese Positionen rechnen (Rest NaN), spart Zeit.
    """
    n = len(df15)
    highs = df15["high"].to_numpy()
    lows = df15["low"].to_numpy()
    closes = df15["close"].to_numpy()
    volumes = df15["volume"].to_numpy()
    out = np.full((n, 3), np.nan)
    todo = np.arange(C.PROFILE_BARS, n) if positions is None else positions[positions >= C.PROFILE_BARS]
    for i in todo:
        s = slice(i - C.PROFILE_BARS, i)
        vol = volumes[s]
        if vol.sum() <= 0:
            continue
        bucket = C.PROFILE_BUCKET_PCT * closes[i - 1]
        out[i] = profile_from_window(highs[s], lows[s], vol, bucket)
    return pd.DataFrame(out, index=df15.index, columns=["poc", "val", "vah"])


# --- Schritt 3: Taker-Delta und Absorption ----------------------------------


def taker_delta(df15: pd.DataFrame) -> pd.Series:
    return (2.0 * df15["taker_buy_base_vol"] - df15["volume"]).rename("delta")


def delta_zscore(delta: pd.Series, window: int = C.DELTA_Z_WINDOW) -> pd.Series:
    """z gegenueber den `window` VORHERIGEN Kerzen (aktuelle Kerze nicht im Fenster), ddof=1."""
    prev = delta.shift(1).rolling(window, min_periods=window)
    std = prev.std()
    return ((delta - prev.mean()) / std.where(std > 0)).rename("delta_z")


def absorption_bars(df15: pd.DataFrame, delta_z: pd.Series, delta_z_max: float = C.DELTA_Z_MAX,
                    new_low_lookback: int = C.NEW_LOW_LOOKBACK) -> pd.Series:
    low = df15["low"]
    prior_min = low.shift(1).rolling(new_low_lookback, min_periods=new_low_lookback).min()
    rng = df15["high"] - low
    close_pos = (df15["close"] - low) / rng.where(rng > 0)
    is_abs = (low < prior_min) & (delta_z < delta_z_max) & (close_pos >= C.CLOSE_POSITION_MIN)
    return is_abs.fillna(False).rename("absorption")


def find_confirmations(df15: pd.DataFrame, delta: pd.Series, absorption: pd.Series,
                       within: int = C.CONFIRM_WITHIN) -> pd.DataFrame:
    """Je Absorptionskerze a die erste Bestaetigungskerze c in a+1..a+within.

    Eine Kerze mit Tief unter dem Absorptionstief laesst das Setup verfallen
    (wird vor der Bestaetigung derselben Kerze geprueft, konservativ).
    """
    high = df15["high"].to_numpy()
    low = df15["low"].to_numpy()
    close = df15["close"].to_numpy()
    d = delta.to_numpy()
    n = len(df15)
    rows = []
    for a in np.flatnonzero(absorption.to_numpy()):
        for c in range(a + 1, min(a + within, n - 1) + 1):
            if low[c] < low[a]:
                break
            if close[c] > high[a] and d[c] > 0:
                rows.append((a, c))
                break
    return pd.DataFrame(rows, columns=["abs_pos", "conf_pos"], dtype=np.int64)


# --- Schritt 1: Umfeld ------------------------------------------------------


def regime_4h(df4h: pd.DataFrame) -> pd.Series:
    """4h-Regime je Kerze (Rezept wie toby_setup/run_phase_segmentation.py)."""
    adx_df = adx(df4h, period=14)
    features = pd.DataFrame(
        {
            "adx": adx_df["adx"],
            "plus_di": adx_df["plus_di"],
            "minus_di": adx_df["minus_di"],
            "slope": linreg_trend(df4h["close"], window=20)["slope"],
            "bandwidth": bollinger_bands(df4h["close"], window=20)["bandwidth"],
            "atr_ratio": atr_ratio(df4h, period=14, sma_window=20),
            "dist_zscore_sma50": distance_to_ma_zscore(df4h["close"], window=50),
        },
        index=df4h.index,
    )
    regime = classify_market_regime(features)
    # classify_market_regime faellt bei fehlenden Werten auf UNRESOLVED_NEUTRAL
    # zurueck; das Protokoll verlangt dort "kein Long" -> eigenes Label.
    return regime.where(features.notna().all(axis=1), "MISSING")


def causal_structure_trend(highs: np.ndarray, lows: np.ndarray, lookback: int = C.STRUCTURE_SWING_LOOKBACK
                           ) -> np.ndarray:
    """structure_trend wie collect-candles::computeMarketStructure, aber kausal.

    Das Original traegt einen Fraktal-Swing bei Kerze j ein, obwohl er erst nach
    Kerze j+lookback feststeht. Hier wird der Swing erst bei Kerze j+lookback
    verarbeitet; Swing-Typ, Trend und CHoCH-Logik sind sonst identisch.
    """
    n = len(highs)
    raw_high = np.zeros(n, dtype=bool)
    raw_low = np.zeros(n, dtype=bool)
    for i in range(lookback, n - lookback):
        window_h = np.concatenate([highs[i - lookback:i], highs[i + 1:i + lookback + 1]])
        window_l = np.concatenate([lows[i - lookback:i], lows[i + 1:i + lookback + 1]])
        raw_high[i] = bool((window_h < highs[i]).all())
        raw_low[i] = bool((window_l > lows[i]).all())

    trend_out = np.empty(n, dtype=object)
    last_high: float | None = None
    last_low: float | None = None
    trend = "ranging"
    for i in range(n):
        j = i - lookback
        swing_type = None
        if j >= 0:
            if raw_high[j]:
                if last_high is not None:
                    swing_type = "HH" if highs[j] > last_high else "LH"
                last_high = highs[j]
            elif raw_low[j]:
                if last_low is not None:
                    swing_type = "HL" if lows[j] > last_low else "LL"
                last_low = lows[j]
        if swing_type in ("HH", "HL"):
            trend = "bullish"
        elif swing_type in ("LH", "LL"):
            trend = "bearish"
        if trend == "bullish":
            if last_low is not None and lows[i] < last_low:
                trend = "bearish"
        elif trend == "bearish":
            if last_high is not None and highs[i] > last_high:
                trend = "bullish"
        trend_out[i] = trend
    return trend_out


def original_structure_trend(highs, lows, lookback=5):
    """1:1-Port von collect-candles::computeMarketStructure (NICHT kausal).

    Nur fuer den Abgleich mit market_features.structure_trend und den Test, der
    den Lookahead des Originals belegt. Im Backtest nie verwenden.
    """
    n = len(highs)
    rh = np.zeros(n, bool)
    rl = np.zeros(n, bool)
    for i in range(lookback, n - lookback):
        o_h = np.r_[highs[i - lookback:i], highs[i + 1:i + lookback + 1]]
        o_l = np.r_[lows[i - lookback:i], lows[i + 1:i + lookback + 1]]
        rh[i] = (o_h < highs[i]).all()
        rl[i] = (o_l > lows[i]).all()
    out, lh, ll, trend = [], None, None, "ranging"
    for i in range(n):
        st = None
        if rh[i]:
            if lh is not None:
                st = "HH" if highs[i] > lh else "LH"
            lh = highs[i]
        elif rl[i]:
            if ll is not None:
                st = "HL" if lows[i] > ll else "LL"
            ll = lows[i]
        if st in ("HH", "HL"):
            trend = "bullish"
        elif st in ("LH", "LL"):
            trend = "bearish"
        if trend == "bullish" and ll is not None and lows[i] < ll:
            trend = "bearish"
        elif trend == "bearish" and lh is not None and highs[i] > lh:
            trend = "bullish"
        out.append(trend)
    return np.array(out, dtype=object)


def confirmed_swing_highs(df1h: pd.DataFrame, lookback: int = C.SWING_HIGH_LOOKBACK_1H) -> pd.DataFrame:
    """Fraktal-Swing-Hochs (lib/swingDetection.ts) mit Bestaetigungszeit.

    Bestaetigt zum Schluss der Kerze j+lookback.
    """
    highs = df1h["high"].to_numpy()
    n = len(highs)
    rows = []
    for j in range(lookback, n - lookback):
        others = np.concatenate([highs[j - lookback:j], highs[j + 1:j + lookback + 1]])
        if (others < highs[j]).all():
            confirm_time = df1h.index[j + lookback] + pd.Timedelta(hours=1)
            rows.append((df1h.index[j], confirm_time, highs[j]))
    return pd.DataFrame(rows, columns=["pivot_time", "confirm_time", "price"])


def asof_closed(values: pd.Series, bar_length: pd.Timedelta, at: pd.DatetimeIndex) -> np.ndarray:
    """Wert der letzten Kerze, deren Schluss (open + bar_length) <= `at` ist."""
    close_times = values.index + bar_length
    pos = np.searchsorted(close_times.values, at.values, side="right") - 1
    arr = values.to_numpy()
    out = np.empty(len(at), dtype=arr.dtype if arr.dtype != object else object)
    if arr.dtype == object:
        out[:] = None
    else:
        out[:] = np.nan
    valid = pos >= 0
    out[valid] = arr[pos[valid]]
    return out


def funding_zscore_series(funding: pd.Series) -> pd.Series:
    from src.features.derivatives import funding_zscore

    return funding_zscore(funding, window=C.FUNDING_Z_WINDOW)


def atr_15m(df15: pd.DataFrame) -> pd.Series:
    return atr(df15, period=C.ATR_PERIOD)
