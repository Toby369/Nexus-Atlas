"""1:1-Port der "Old Money Stack"-Breakout-Logik (Claudius Vertesi, Nutzer-
Bericht 18.09.2026): SR-Linien aus Pivot-CLOSES, Ausbruchskerzen-Validierung
(Body-Anteil/Docht-Anteil/Groessen-Limit), Entry am Close der Ausbruchskerze.

SR-Linien-Semantik (Nutzer-Entscheidung 18.09.2026, AskUserQuestion): nur die
JEWEILS ZULETZT bestaetigte Resistance und Support gleichzeitig aktiv (wie
LSOB's lastPH/lastPL) -- eine neue ersetzt die alte. Konsequenz: fuer den in
der Strategie-Beschreibung genannten Abstandscheck ("genug Platz bis zur
naechsten SR-Linie fuer CRV 1:2") existiert unter dieser Regel NIE eine
weitere Linie in Zielrichtung (die einzige andere verfolgte Linie liegt
hinter dem Kurs, nicht davor) -- das Filter ist unter dieser Wahl technisch
immer erfuellt, TP ist praktisch immer der feste 1:2-Wert. Siehe README fuer
die ausfuehrliche Begruendung; hier bewusst NICHT extra implementiert, da es
unter der gewaehlten Regel keinen Unterschied machen wuerde.

Ausbruch = UEBERGANG (vorherige Bar noch nicht durchbrochen, diese Bar
erstmals durchbrochen) -- sonst wuerde jede Folge-Bar, die zufaellig auch
noch ueber der Linie liegt, erneut ein Signal feuern, solange der Kurs
einfach weiter in dieselbe Richtung laeuft. Das steht nicht explizit im
Nutzer-Bericht, ist aber durch das Konzept "Ausbruchskerze" (singularisch,
EIN Ereignis) klar impliziert.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import OmsParams
from pivots import pivot_high, pivot_low


@dataclass
class Signal:
    time: pd.Timestamp
    bar_index: int
    direction: str  # "long" | "short"
    entry_price: float  # Close der Ausbruchskerze
    sl_price: float  # entgegengelegener Docht der Ausbruchskerze (low fuer long, high fuer short)
    level: float  # die durchbrochene SR-Linie


def _forward_fill(revealed: np.ndarray) -> np.ndarray:
    return pd.Series(revealed).ffill().to_numpy()


def run_oms(df: pd.DataFrame, params: OmsParams) -> list[Signal]:
    """df: DataFrame mit Spalten open/high/low/close, aufsteigend sortiert."""
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    close = df["close"].to_numpy()
    open_ = df["open"].to_numpy()
    times = df.index.to_numpy()
    n = len(df)

    # SR-Linien: Pivot High/Low auf CLOSE (Nutzer-Vorgabe), nicht High/Low.
    ph_revealed = pivot_high(close, params.pivot_length, params.pivot_length)
    pl_revealed = pivot_low(close, params.pivot_length, params.pivot_length)
    last_resistance = _forward_fill(ph_revealed)
    last_support = _forward_fill(pl_revealed)

    rng = high - low
    range_sma = pd.Series(rng).rolling(params.range_sma_period).mean().to_numpy()
    max_range = range_sma * params.max_candle_multiplier

    signals: list[Signal] = []

    for i in range(1, n):
        o, h, l, c = open_[i], high[i], low[i], close[i]
        r = rng[i]
        max_r = max_range[i]
        prev_c = close[i - 1]

        res = last_resistance[i]
        if (
            not np.isnan(res)
            and c > res
            and prev_c <= res  # Uebergang: erst DIESE Bar durchbricht
            and c > o  # bullische Ausbruchskerze
            and r > 0
            and not np.isnan(max_r)
            and r <= max_r
        ):
            body_out_frac = (c - max(o, res)) / (c - o)
            upper_wick_frac = (h - max(o, c)) / r
            if body_out_frac > params.body_out_threshold and upper_wick_frac <= params.max_wick_ratio:
                signals.append(
                    Signal(time=times[i], bar_index=i, direction="long", entry_price=c, sl_price=l, level=res)
                )

        sup = last_support[i]
        if (
            not np.isnan(sup)
            and c < sup
            and prev_c >= sup
            and c < o  # baerische Ausbruchskerze
            and r > 0
            and not np.isnan(max_r)
            and r <= max_r
        ):
            body_out_frac = (min(o, sup) - c) / (o - c)
            lower_wick_frac = (min(o, c) - l) / r
            if body_out_frac > params.body_out_threshold and lower_wick_frac <= params.max_wick_ratio:
                signals.append(
                    Signal(time=times[i], bar_index=i, direction="short", entry_price=c, sl_price=h, level=sup)
                )

    return signals
