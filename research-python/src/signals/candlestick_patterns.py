"""7 klassische Kerzenmuster (Nison), Python-Neuimplementierung fuer das
Toby-Setup-Phasen-Signal-Projekt -- die Original-Erkennung lief als SQL
(`research_detect_candlestick_patterns()`, siehe
docs/research/CANDLESTICK-PATTERNS_2026-09-04.md), hier auf Basis der dort
dokumentierten Methodik nachgebaut, NICHT 1:1 aus dem SQL portiert (die
Funktion selbst wurde nicht wiedergefunden/eingesehen).

Uebernommen (Kategorie A -- woertlich aus dem Methodik-Abschnitt des
Berichts): 7 Muster (Doji, Hammer, Hanging Man, Bullish/Bearish Engulfing,
Morning/Evening Star), Doji-Body<=10% Range, Hammer/Hanging-Man-Body<=30%
Range mit unterem Docht>=50% Range, Star-Rolle: Trendkerzen (1./3.)
Body>=50% Range, mittlere "Star"-Kerze Body<=30% Range, Trendkontext fuer
Hammer/Hanging-Man/Doji-Richtung = close[t-1] vs close[t-6] (Trend endet
VOR der Musterkerze).

Rekonstruiert (Kategorie C -- im Bericht nicht spezifiziert, hier nach
Standard-Nison-Definition ergaenzt, da die dokumentierten Schwellen allein
nicht vollstaendig sind): Engulfing hat im Bericht keine eigene
%-Schwelle -- hier Standarddefinition (aktuelle Kerze umschliesst den
Body der Vorkerze vollstaendig, keine zusaetzliche Grossenschwelle).
Morning/Evening-Star-Bestaetigung ("schliesst weit in den Body der ersten
Kerze") -- hier per Standard-Nison-Kriterium: 3. Kerze schliesst ueber/
unter dem Mittelpunkt des Bodys der 1. Kerze.

Alle Erkennungsfunktionen sind rein aus OHLC der aktuellen und bis zu 5
vorangegangenen Kerzen (fuer den Trendkontext) berechnet, punkt-in-Zeit-
sicher (nur `shift()` rueckwaerts, kein `shift(-n)`).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

DOJI_MAX_BODY_PCT = 0.10
HAMMER_MAX_BODY_PCT = 0.30
HAMMER_MIN_LOWER_WICK_PCT = 0.50
STAR_TREND_MIN_BODY_PCT = 0.50
STAR_MIDDLE_MAX_BODY_PCT = 0.30
TREND_CONTEXT_LOOKBACK = 6  # close[t-1] vs close[t-6]

PATTERN_COLUMNS = [
    "doji", "hammer", "hanging_man", "bullish_engulfing", "bearish_engulfing",
    "morning_star", "evening_star",
]


def _require_ohlc_columns(ohlc: pd.DataFrame) -> None:
    missing = {"open", "high", "low", "close"} - set(ohlc.columns)
    if missing:
        raise ValueError(f"ohlc is missing required columns: {sorted(missing)}")
    if not ohlc.index.is_monotonic_increasing:
        raise ValueError("candlestick_patterns: index must be monotonically increasing (chronological).")


def detect_candlestick_patterns(ohlc: pd.DataFrame) -> pd.DataFrame:
    """Erkennt alle 7 Muster je Bar. Rueckgabe: pd.DataFrame mit einer
    booleschen Spalte je Muster (siehe `PATTERN_COLUMNS`), gleicher Index
    wie `ohlc`, nie NaN (False wenn Kontext/Vorkerzen fehlen)."""
    _require_ohlc_columns(ohlc)

    o, h, l, c = ohlc["open"], ohlc["high"], ohlc["low"], ohlc["close"]
    body = (c - o).abs()
    rng = (h - l).replace(0, np.nan)
    upper_wick = h - pd.concat([o, c], axis=1).max(axis=1)
    lower_wick = pd.concat([o, c], axis=1).min(axis=1) - l
    body_pct = body / rng
    lower_wick_pct = lower_wick / rng

    is_bullish = c > o
    is_bearish = c < o

    prior_close = c.shift(1)
    trend_close = c.shift(TREND_CONTEXT_LOOKBACK)
    prior_uptrend = prior_close > trend_close
    prior_downtrend = prior_close < trend_close

    # --- Doji ---
    is_doji_shape = body_pct <= DOJI_MAX_BODY_PCT
    doji = (is_doji_shape & (prior_uptrend | prior_downtrend)).fillna(False)

    # --- Hammer / Hanging Man (gleiche Form, Richtung aus Trendkontext) ---
    is_hammer_shape = (body_pct <= HAMMER_MAX_BODY_PCT) & (lower_wick_pct >= HAMMER_MIN_LOWER_WICK_PCT)
    hammer = (is_hammer_shape & prior_downtrend).fillna(False)
    hanging_man = (is_hammer_shape & prior_uptrend).fillna(False)

    # --- Bullish / Bearish Engulfing (Standarddefinition, Kategorie C) ---
    prior_open = o.shift(1)
    prior_close_ = c.shift(1)
    prior_is_bearish = prior_close_ < prior_open
    prior_is_bullish = prior_close_ > prior_open
    bullish_engulfing = (
        is_bullish & prior_is_bearish & (o <= prior_close_) & (c >= prior_open)
    ).fillna(False)
    bearish_engulfing = (
        is_bearish & prior_is_bullish & (o >= prior_close_) & (c <= prior_open)
    ).fillna(False)

    # --- Morning / Evening Star (3-Kerzen, Standard-Nison-Bestaetigung, Kategorie C) ---
    o1, c1 = o.shift(2), c.shift(2)  # 1. Kerze (Trend)
    body1 = (c1 - o1).abs()
    rng1 = (h.shift(2) - l.shift(2)).replace(0, np.nan)
    body1_pct = body1 / rng1
    o2, c2 = o.shift(1), c.shift(1)  # 2. Kerze (Star)
    body2 = (c2 - o2).abs()
    rng2 = (h.shift(1) - l.shift(1)).replace(0, np.nan)
    body2_pct = body2 / rng2
    body3_pct = body_pct  # 3. Kerze = aktuelle Kerze
    midpoint1 = (o1 + c1) / 2

    first_is_bearish = c1 < o1
    first_is_bullish = c1 > o1
    star_shape_ok = (body1_pct >= STAR_TREND_MIN_BODY_PCT) & (body2_pct <= STAR_MIDDLE_MAX_BODY_PCT) & (
        body3_pct >= STAR_TREND_MIN_BODY_PCT
    )
    morning_star = (
        star_shape_ok & first_is_bearish & is_bullish & (c > midpoint1)
    ).fillna(False)
    evening_star = (
        star_shape_ok & first_is_bullish & is_bearish & (c < midpoint1)
    ).fillna(False)

    return pd.DataFrame(
        {
            "doji": doji, "hammer": hammer, "hanging_man": hanging_man,
            "bullish_engulfing": bullish_engulfing, "bearish_engulfing": bearish_engulfing,
            "morning_star": morning_star, "evening_star": evening_star,
        },
        index=ohlc.index,
    )
