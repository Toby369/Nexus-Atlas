"""Orderflow-Signalgruppe (CVD-Trend, VWAP-Position) fuer das Toby-Setup-
Phasen-Signal-Projekt, siehe docs/research/TOBY-SETUP-PHASEN-DEFINITION.md.

CVD (Kategorie A -- Formel exakt aus `docs/research/phase6-ist-zustand-
audit.md` Zeile 3 uebernommen, `cvd_delta` exakt aus dem Code-Kommentar in
`lib/tradingIndicatorsContext.ts` "2*taker_buy_base_vol-volume AM NATIVEN
INTERVALL selbst"): cvd_delta_t = 2*taker_buy_base_vol_t - volume_t je
15m-Bar (KEIN 1-Minuten-Rollup, anders als der separate "CVD-Footprint"-
Indikator). cvd_cumulative = laufende Summe seit Datensatzbeginn (unbegrenzt,
nur die AENDERUNG ueber das Lookback-Fenster ist fuer die Trend-
Klassifikation relevant, ein Reset-Anker aendert daher nichts am Ergebnis).
Trend-Klassifikation (rising/falling/flat) -- Kategorie A, exakt aus
`classifyCvdTrend()` in `lib/tradingIndicatorsContext.ts` portiert, Lookback
5 (= `CVD_TREND_LOOKBACK` in `collect-candles`, gleicher Wert wie dort).

VWAP-Position (Kategorie A fuer die Faktor-Schwelle, Kategorie C fuer den
VWAP selbst): `factor_vwap_position` aus `legacy_factors.py` uebernommen
(>0.15%/-0.15% Schwelle, exakt aus dem Audit). Der zugrunde liegende VWAP
ist in der Produktion nicht dokumentiert einsehbar -- hier als
Standard-Tages-Anker-VWAP (HLC3-gewichtet, Reset an jeder UTC-Kalendertag-
Grenze) implementiert, die ueblichste VWAP-Definition, explizit als
Rekonstruktion gekennzeichnet.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.features.legacy_factors import factor_cvd, factor_vwap_position

CVD_TREND_LOOKBACK = 5


def compute_cvd_delta(volume: pd.Series, taker_buy_base_vol: pd.Series) -> pd.Series:
    return (2.0 * taker_buy_base_vol - volume).rename("cvd_delta")


def classify_cvd_trend(delta: pd.Series, lookback: int = CVD_TREND_LOOKBACK) -> pd.Series:
    """1:1-Port von `classifyCvdTrend()`. `delta`: cvd_delta je Bar
    (kausal, kein Rollup). Kausal: Bar i benoetigt nur delta[i-lookback+1..i]
    und cumulative[i]/cumulative[i-lookback]."""
    cumulative = delta.cumsum()
    change = cumulative - cumulative.shift(lookback)
    recent_avg_abs_delta = delta.abs().rolling(window=lookback, min_periods=lookback).mean()
    flat_threshold = recent_avg_abs_delta * 0.5

    trend = pd.Series(pd.array([None] * len(delta), dtype="object"), index=delta.index)
    known = change.notna() & flat_threshold.notna()
    is_flat = known & (change.abs() < flat_threshold)
    is_rising = known & ~is_flat & (change > 0)
    is_falling = known & ~is_flat & (change <= 0)
    trend[is_flat] = "flat"
    trend[is_rising] = "rising"
    trend[is_falling] = "falling"
    return trend.rename("cvd_trend")


def compute_day_anchored_vwap(ohlc: pd.DataFrame) -> pd.Series:
    """Tages-Anker-VWAP (Reset an jeder UTC-Kalendertag-Grenze), typical
    price = HLC3. Rekonstruktion, siehe Modul-Docstring."""
    typical = (ohlc["high"] + ohlc["low"] + ohlc["close"]) / 3.0
    pv = typical * ohlc["volume"]
    day = ohlc.index.tz_convert("UTC").date if ohlc.index.tz is not None else ohlc.index.date
    day = pd.Series(day, index=ohlc.index)
    cum_pv = pv.groupby(day).cumsum()
    cum_vol = ohlc["volume"].groupby(day).cumsum()
    return (cum_pv / cum_vol.replace(0, np.nan)).rename("vwap")


def compute_orderflow_signals(ohlc: pd.DataFrame) -> pd.DataFrame:
    """ohlc: Spalten open/high/low/close/volume/taker_buy_base_vol.

    Returns
    -------
    pd.DataFrame mit booleschen Spalten: cvd_bullish, cvd_bearish,
    vwap_above, vwap_below.
    """
    delta = compute_cvd_delta(ohlc["volume"], ohlc["taker_buy_base_vol"])
    cvd_trend = classify_cvd_trend(delta)
    cvd_score = factor_cvd(cvd_trend)

    vwap = compute_day_anchored_vwap(ohlc)
    vwap_score = factor_vwap_position(ohlc["close"], vwap)

    return pd.DataFrame(
        {
            "cvd_bullish": (cvd_score == 1.0).fillna(False),
            "cvd_bearish": (cvd_score == -1.0).fillna(False),
            "vwap_above": (vwap_score == 1.0).fillna(False),
            "vwap_below": (vwap_score == -1.0).fillna(False),
        },
        index=ohlc.index,
    )
