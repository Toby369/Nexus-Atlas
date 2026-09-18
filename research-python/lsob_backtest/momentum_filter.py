"""Zusaetzlicher Bestaetigungsfilter fuer LSOB-Entry-Signale: MACD-Crossover
in Trade-Richtung + RSI auf der richtigen Seite der 50-Linie. Nutzer-
Vorgabe (18.09.2026, aus Erfahrung: "nehme nicht jeden validen Trade,
schaue noch auf MACD und RSI"):

- Long nur, wenn MACD-Linie ueber der Signal-Linie liegt UND RSI(14) > 50.
- Short nur, wenn MACD-Linie unter der Signal-Linie liegt UND RSI(14) < 50.

Beide Bedingungen werden auf der Confirmation-Bar selbst geprueft (bar_index
des Signals) -- kein Blick auf spaetere Bars, kein Look-Ahead: MACD/RSI an
dieser Bar nutzen ausschliesslich Preise bis und mit dieser Bar.

Hinweis Aufwaermphase: RSI/MACD sind rechnerisch schon ab den ersten paar
Bars ein (nicht-NaN) Zahlenwert, aber noch nicht eingeschwungen (siehe
indicators.py). Fuer LSOB-Signale unkritisch -- die fruehestmoegliche
Confirmation-Bar liegt durch Pivot-Bestaetigung + Sweep + Retest ohnehin
weit hinter dem MACD-Slow-Zeitraum (26 Bars).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from indicators import macd, rsi
from lsob_engine import Signal


@dataclass(frozen=True)
class MomentumFilterParams:
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    rsi_period: int = 14


def apply_macd_rsi_filter(
    df: pd.DataFrame, signals: list[Signal], params: MomentumFilterParams = MomentumFilterParams()
) -> list[Signal]:
    macd_line, signal_line, _ = macd(df["close"], params.macd_fast, params.macd_slow, params.macd_signal)
    rsi_series = rsi(df["close"], params.rsi_period)

    kept: list[Signal] = []
    for s in signals:
        i = s.bar_index
        m, sig, r = macd_line.iloc[i], signal_line.iloc[i], rsi_series.iloc[i]
        if s.direction == "long":
            confirmed = (m > sig) and (r > 50)
        else:
            confirmed = (m < sig) and (r < 50)
        # NaN-Vergleiche sind in Python False -- ein Signal exakt auf der
        # allerersten Bar des Datensatzes (macd_line/rsi dort NaN wegen
        # close.diff()) wuerde dadurch automatisch NICHT bestaetigt. In der
        # Praxis kommt das nie vor, siehe Docstring oben.
        if confirmed:
            kept.append(s)
    return kept
