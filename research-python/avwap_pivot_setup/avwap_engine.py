"""AVWAP-Pivot-Konfluenz-Rejection-Signale (Tobys eigene Setup-Idee,
18.09.2026, siehe config.py-Docstring und der Backtest-Report fuer die
Recherche-Grundlage).

Kernidee: an jedem bestaetigten Pivot-High/-Low (auf CLOSE) wird eine neue
Anchored-VWAP-Linie gestartet, die fortlaufend Volumen akkumuliert. Mehrere
solcher Linien bleiben GLEICHZEITIG aktiv (Konfluenz-Zonen, Nutzer-
Entscheidung), bis der Kurs sie mit einem SCHLUSSKURS eindeutig durchbricht
(dann invalidiert -- keine Unterstuetzung/Widerstand mehr). Beruehrt eine
Kerze eine oder mehrere aktive Linien (Docht erreicht den Wert) und der
SCHLUSS der Kerze bleibt auf der Ausgangsseite der NAECHSTLIEGENDEN
beruehrten Linie: Rejection-Signal in die Gegenrichtung (Nutzer-Vorgabe:
"Kurs laeuft mit meinem Setup in entgegengesetzte Richtung").

Look-Ahead-Sicherheit: eine an Bar `t` enthuellte Pivot-Linie (Pine-Lag,
siehe pivots.py) ist fruehestens ab Bar `t+1` fuer Signale nutzbar -- nicht
auf der Enthuellungs-Bar selbst, da ihr exakter AVWAP-Wert (inkl. dieser
Bar) erst mit deren eigenem Schluss feststeht.
"""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from config import AvwapPivotParams
from pivots import pivot_high, pivot_low


@dataclass
class ActiveLine:
    anchor_idx: int
    cum_pv: float
    cum_v: float

    @property
    def value(self) -> float:
        return self.cum_pv / self.cum_v


@dataclass
class Signal:
    time: pd.Timestamp
    bar_index: int
    direction: str  # "LONG" | "SHORT"
    entry_price: float  # Close der Rejection-Kerze
    level: float  # Wert der naechstliegenden (primaeren) getesteten AVWAP-Linie
    confluence_count: int  # Anzahl gleichzeitig beruehrter aktiver Linien derselben Seite


def run_avwap_pivot_signals(df: pd.DataFrame, params: AvwapPivotParams) -> list[Signal]:
    """df: OHLCV-DataFrame (Spalten open/high/low/close/volume), aufsteigend
    sortiert, DatetimeIndex."""
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    close = df["close"].to_numpy()
    volume = df["volume"].to_numpy()
    times = df.index.to_numpy()
    n = len(df)

    typical = (high + low + close) / 3.0
    pv = typical * volume
    # prefix_pv[k] = Summe von pv[0..k-1] -> Summe ueber [a,b] (inkl.) ist prefix_pv[b+1]-prefix_pv[a]
    prefix_pv = np.concatenate([[0.0], np.cumsum(pv)])
    prefix_v = np.concatenate([[0.0], np.cumsum(volume)])

    ph_revealed = pivot_high(close, params.pivot_length, params.pivot_length)
    pl_revealed = pivot_low(close, params.pivot_length, params.pivot_length)

    active_resistance: list[ActiveLine] = []
    active_support: list[ActiveLine] = []
    signals: list[Signal] = []

    for t in range(n):
        h, l, c = high[t], low[t], close[t]

        # 1. Bereits (vor dieser Bar) aktive Linien um diese Bar fortschreiben.
        for line in active_resistance:
            line.cum_pv += pv[t]
            line.cum_v += volume[t]
        for line in active_support:
            line.cum_pv += pv[t]
            line.cum_v += volume[t]

        # 2. Rejection-Signale anhand der (jetzt inkl. dieser Bar) aktuellen Werte.
        touched_res = sorted((ln for ln in active_resistance if l <= ln.value <= h), key=lambda ln: ln.value)
        if touched_res:
            primary = touched_res[0]  # naechstliegende Linie von unten
            if c < primary.value:
                signals.append(
                    Signal(times[t], t, "SHORT", c, primary.value, len(touched_res))
                )

        touched_sup = sorted((ln for ln in active_support if l <= ln.value <= h), key=lambda ln: ln.value)
        if touched_sup:
            primary = touched_sup[-1]  # naechstliegende Linie von oben
            if c > primary.value:
                signals.append(
                    Signal(times[t], t, "LONG", c, primary.value, len(touched_sup))
                )

        # 3. Invalidierung: Schlusskurs bricht eine Linie eindeutig -> nicht mehr S/R.
        active_resistance = [ln for ln in active_resistance if c <= ln.value]
        active_support = [ln for ln in active_support if c >= ln.value]

        # 4. Neu enthuellte Pivot-Linien hinzufuegen -- ERST NACH der Signalpruefung
        #    dieser Bar, damit sie fruehestens ab der NAECHSTEN Bar testbar sind.
        if not np.isnan(ph_revealed[t]):
            anchor_idx = t - params.pivot_length
            cum_pv = prefix_pv[t + 1] - prefix_pv[anchor_idx]
            cum_v = prefix_v[t + 1] - prefix_v[anchor_idx]
            if cum_v > 0:
                active_resistance.append(ActiveLine(anchor_idx, cum_pv, cum_v))
                active_resistance = active_resistance[-params.max_active_lines_per_side :]
        if not np.isnan(pl_revealed[t]):
            anchor_idx = t - params.pivot_length
            cum_pv = prefix_pv[t + 1] - prefix_pv[anchor_idx]
            cum_v = prefix_v[t + 1] - prefix_v[anchor_idx]
            if cum_v > 0:
                active_support.append(ActiveLine(anchor_idx, cum_pv, cum_v))
                active_support = active_support[-params.max_active_lines_per_side :]

    return signals


def signals_to_dataframe(signals: list[Signal]) -> pd.DataFrame:
    return pd.DataFrame([s.__dict__ for s in signals])
