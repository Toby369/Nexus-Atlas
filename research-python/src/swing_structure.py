"""Swing-Pivot- ("Knickpunkt"-) Struktur nach Dow-Theorie (HH/HL vs. LH/LL),
siehe docs/research/TOBY-SETUP-PHASEN-DEFINITION.md Abschnitt "Strukturelle
Phasen" -- zweite, unabhaengige Bestaetigung neben dem bereits vorhandenen
Indikator-Regime (`src/regime.py`), Nutzer-Entscheidung 19.09.2026
("zusaetzlich Swing-Pivot/Knickpunkt-Check").

ZigZag-Pivot-Erkennung mit ATR-Vielfachem als Reversal-Schwelle (statt
fixem %-Wert) -- skaliert automatisch mit BTCs stark wechselnder Volatilitaet
ueber die 2022-2026-Historie, anstatt einen einzigen %-Wert ueber sehr
unterschiedliche Vola-Regime hinweg zu erzwingen. `atr_multiple=2.0`
(Default) ist ein dokumentierter, veraenderbarer Parameter, keine
Gewissheit.

Kausalitaet: ein Pivot wird erst BESTAETIGT, wenn der Kurs seit dem
laufenden Extrem um >= atr_multiple * ATR (zum Zeitpunkt der Bestaetigung,
nicht zum Zeitpunkt des Extrems) zurueckgesetzt hat. Der Struktur-Zustand
an Bar t verwendet ausschliesslich Pivots, die bis (und mit) Bar t bereits
bestaetigt wurden -- der Pivot selbst kann in der Vergangenheit liegen
(cand_idx < confirm_idx), das Wissen darueber existiert aber nachweislich
erst ab confirm_idx. Verifiziert in tests/test_swing_structure.py per
Truncation-Technik (gleiche Methode wie tests/lookahead_utils.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.features.volatility import atr

STRUCTURE_BULLISH = "STRUCTURE_BULLISH"  # letzte 2 Hochs UND letzte 2 Tiefs steigend (HH+HL)
STRUCTURE_BEARISH = "STRUCTURE_BEARISH"  # letzte 2 Hochs UND letzte 2 Tiefs fallend (LH+LL)
STRUCTURE_MIXED = "STRUCTURE_MIXED"  # widerspruechlich (z.B. HH aber LL) -- "keine klare Struktur"
STRUCTURE_UNKNOWN = "STRUCTURE_UNKNOWN"  # noch keine 2 bestaetigten Pivots je Typ (Anlaufzeit)

ALL_STRUCTURE_STATES = (STRUCTURE_BULLISH, STRUCTURE_BEARISH, STRUCTURE_MIXED, STRUCTURE_UNKNOWN)


@dataclass(frozen=True)
class SwingPivot:
    confirm_idx: int  # Bar-Position, an der der Pivot bestaetigt wurde (kausal massgeblich)
    pivot_idx: int  # Bar-Position des tatsaechlichen Extrems (<= confirm_idx)
    pivot_type: str  # "HIGH" | "LOW"
    price: float


def _require_ohlc_columns(ohlc: pd.DataFrame) -> None:
    missing = {"high", "low"} - set(ohlc.columns)
    if missing:
        raise ValueError(f"ohlc is missing required columns: {sorted(missing)}")
    if not ohlc.index.is_monotonic_increasing:
        raise ValueError("swing_structure: index must be monotonically increasing (chronological).")


def compute_zigzag_pivots(
    ohlc: pd.DataFrame,
    atr_period: int = 14,
    atr_multiple: float = 2.0,
) -> list[SwingPivot]:
    """Kausale ZigZag-Pivot-Erkennung. Vor der ersten Bestaetigung werden
    ZWEI Kandidaten (ein Hoch- und ein Tief-Kandidat) parallel verfolgt, da
    zu Beginn nicht bekannt ist, ob die erste Bewegung ein Hoch oder ein
    Tief markiert -- Standardtechnik fuer kausale ZigZag-Implementierungen.
    """
    _require_ohlc_columns(ohlc)
    atr_series = atr(ohlc, period=atr_period)
    first_valid = atr_series.first_valid_index()
    if first_valid is None:
        return []
    start_i = ohlc.index.get_loc(first_valid)

    highs = ohlc["high"].to_numpy()
    lows = ohlc["low"].to_numpy()
    atr_vals = atr_series.to_numpy()
    n = len(ohlc)

    pivots: list[SwingPivot] = []
    direction: str | None = None  # None (beide Kandidaten offen) | "UP" (Hoch-Kandidat laeuft) | "DOWN" (Tief-Kandidat laeuft)
    cand_high_idx, cand_high_price = start_i, highs[start_i]
    cand_low_idx, cand_low_price = start_i, lows[start_i]

    for i in range(start_i, n):
        atr_i = atr_vals[i]
        if np.isnan(atr_i):
            continue
        hi, lo = highs[i], lows[i]

        if direction is None:
            if hi > cand_high_price:
                cand_high_price, cand_high_idx = hi, i
            if lo < cand_low_price:
                cand_low_price, cand_low_idx = lo, i
            if cand_high_price - lo >= atr_multiple * atr_i:
                pivots.append(SwingPivot(i, cand_high_idx, "HIGH", cand_high_price))
                direction = "DOWN"
                cand_low_price, cand_low_idx = lo, i
            elif hi - cand_low_price >= atr_multiple * atr_i:
                pivots.append(SwingPivot(i, cand_low_idx, "LOW", cand_low_price))
                direction = "UP"
                cand_high_price, cand_high_idx = hi, i
            continue

        if direction == "UP":
            if hi > cand_high_price:
                cand_high_price, cand_high_idx = hi, i
            elif cand_high_price - lo >= atr_multiple * atr_i:
                pivots.append(SwingPivot(i, cand_high_idx, "HIGH", cand_high_price))
                direction = "DOWN"
                cand_low_price, cand_low_idx = lo, i
        else:
            if lo < cand_low_price:
                cand_low_price, cand_low_idx = lo, i
            elif hi - cand_low_price >= atr_multiple * atr_i:
                pivots.append(SwingPivot(i, cand_low_idx, "LOW", cand_low_price))
                direction = "UP"
                cand_high_price, cand_high_idx = hi, i

    return pivots


def classify_swing_structure(
    ohlc: pd.DataFrame,
    atr_period: int = 14,
    atr_multiple: float = 2.0,
) -> pd.Series:
    """Pro-Bar-Struktur-Zustand aus den bis dahin bestaetigten ZigZag-Pivots:
    STRUCTURE_BULLISH (HH+HL), STRUCTURE_BEARISH (LH+LL), STRUCTURE_MIXED
    (widerspruechlich), STRUCTURE_UNKNOWN (noch keine 2 Pivots je Typ).
    Zustand gilt ab dem `confirm_idx` des jeweils auslösenden Pivots bis zur
    naechsten Bestaetigung (kein Blick in die Zukunft, siehe Modul-Docstring).

    Returns
    -------
    pd.Series of str, gleicher Index wie `ohlc`, nie NaN.
    """
    pivots = compute_zigzag_pivots(ohlc, atr_period=atr_period, atr_multiple=atr_multiple)
    n = len(ohlc)
    state = np.full(n, STRUCTURE_UNKNOWN, dtype=object)

    highs: list[float] = []
    lows: list[float] = []

    # Pivots sind chronologisch nach confirm_idx sortiert (Entstehungsreihenfolge
    # der ZigZag-Schleife) -- jede Zuweisung state[confirm_idx:] = current
    # ueberschreibt daher nur den "Schwanz" ab diesem Punkt; das Segment
    # zwischen zwei aufeinanderfolgenden Bestaetigungen behaelt exakt den
    # bei der frueheren Bestaetigung gesetzten Wert (kein Extra-Fill noetig).
    for pivot in pivots:
        if pivot.pivot_type == "HIGH":
            highs.append(pivot.price)
        else:
            lows.append(pivot.price)

        if len(highs) >= 2 and len(lows) >= 2:
            if highs[-1] > highs[-2] and lows[-1] > lows[-2]:
                current = STRUCTURE_BULLISH
            elif highs[-1] < highs[-2] and lows[-1] < lows[-2]:
                current = STRUCTURE_BEARISH
            else:
                current = STRUCTURE_MIXED
        else:
            current = STRUCTURE_UNKNOWN

        state[pivot.confirm_idx :] = current

    return pd.Series(state, index=ohlc.index, name="swing_structure")
