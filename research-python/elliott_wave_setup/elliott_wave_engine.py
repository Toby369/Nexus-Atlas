"""Elliott-Wave-Impuls-Erkennung (1-2-3-4-5) nach Tobys Spezifikation
(19.09.2026): fraktale Zick-Zack-Ermittlung (Pivots auf HIGH/LOW, nicht
CLOSE -- Tobys ta.pivothigh(high,N,N)/ta.pivotlow(low,N,N)) + die drei
"eisernen" Elliott-Wave-Regeln + Fibonacci-Proportionsfilter. Nach einer
bestaetigten Impulswelle wird ein Reversal-Signal in die Gegenrichtung
erzeugt (Erwartung: A-B-C-Korrektur folgt), das mit Tobys Setup-Exit-Logik
weiterverarbeitet wird (siehe backtest.py).

Zick-Zack-Konstruktion (nicht explizit in Tobys Spezifikation, Standard-
Technik zur Zusammenfuehrung separat erkannter Pivot-Highs/-Lows zu einer
EINEN alternierenden Punktfolge): Pivots desselben Typs, die aufeinander
folgen OHNE dass zwischendurch ein Pivot des anderen Typs aufgetreten ist,
werden zusammengefasst -- nur der EXTREMERE (hoeheres Hoch / tieferes Tief)
bleibt im Zick-Zack. Erst ein Pivot des jeweils anderen Typs haengt einen
neuen Punkt an.

WICHTIGE EINSCHRAENKUNG (dokumentierte Vereinfachung, analog zur
"reveal-lag"-Konvention der anderen Projekte dieser Session): ein Signal
feuert, sobald P5 zum ERSTEN MAL als alternierender Punkt angehaengt wird
(an seiner eigenen Pivot-Enthuellungs-Bar). Erscheint SPAETER ein noch
extremerer Punkt desselben Typs (P5 wird durch die Zick-Zack-Logik oben
ersetzt), wird das bereits gefeuerte Signal NICHT rueckwirkend annulliert --
entspricht der Grenze eines Live-Indikators, der zum Zeitpunkt des
Labels bereits gehandelt haette.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import ElliottWaveParams
from pivots import pivot_high, pivot_low


@dataclass
class ZigzagPoint:
    bar_index: int  # tatsaechlicher Pivot-Bar-Index (nicht Enthuellungs-Bar)
    price: float
    kind: str  # "H" | "L"


@dataclass
class Signal:
    time: pd.Timestamp
    bar_index: int  # Enthuellungs-Bar von P5 (Signal-Bar)
    direction: str  # "LONG" | "SHORT" -- Reversal-Richtung NACH dem Impuls
    entry_price: float  # Close der Signal-Bar
    wave5_price: float
    wave2_retrace: float
    wave3_extension: float
    wave4_retrace: float


def _check_impulse(points: list[ZigzagPoint], params: ElliottWaveParams) -> tuple[str, float, float, float] | None:
    """points = [start, p1, p2, p3, p4, p5], bereits alternierend. Prueft
    beide Richtungen (bullisch: L,H,L,H,L,H -> Reversal SHORT; baerisch:
    H,L,H,L,H,L -> Reversal LONG). Gibt (direction, w2_retrace, w3_ext,
    w4_retrace) zurueck oder None."""
    kinds = "".join(p.kind for p in points)
    start, p1, p2, p3, p4, p5 = points

    if kinds == "LHLHLH":
        is_bullish = True
    elif kinds == "HLHLHL":
        is_bullish = False
    else:
        return None

    if is_bullish:
        length1 = p1.price - start.price
        length3 = p3.price - p2.price
        length5 = p5.price - p4.price
    else:
        length1 = start.price - p1.price
        length3 = p2.price - p3.price
        length5 = p4.price - p5.price

    if length1 <= 0 or length3 <= 0 or length5 <= 0:
        return None

    # Regel 1: Welle 2 durchbricht nicht den Start von Welle 1.
    if is_bullish:
        if not (p2.price > start.price):
            return None
    else:
        if not (p2.price < start.price):
            return None

    # Regel 2: Welle 3 ist nicht die kuerzeste Impulswelle.
    if not (length3 >= length1 or length3 >= length5):
        return None

    # Regel 3: Welle 4 ueberlappt nicht mit Welle 1.
    if is_bullish:
        if not (p4.price > p1.price):
            return None
    else:
        if not (p4.price < p1.price):
            return None

    # Fibonacci-Filter.
    wave2_retrace = (p1.price - p2.price) / length1 if is_bullish else (p2.price - p1.price) / length1
    if not (params.wave2_retrace_min <= wave2_retrace <= params.wave2_retrace_max):
        return None

    wave3_extension = length3 / length1
    if not (wave3_extension >= params.wave3_extension_min):
        return None

    wave4_retrace = (p3.price - p4.price) / length3 if is_bullish else (p4.price - p3.price) / length3
    if not (wave4_retrace <= params.wave4_retrace_max):
        return None

    direction = "SHORT" if is_bullish else "LONG"  # Reversal nach Impuls-Ende
    return direction, wave2_retrace, wave3_extension, wave4_retrace


def run_elliott_wave_signals(df: pd.DataFrame, params: ElliottWaveParams) -> list[Signal]:
    """df: OHLCV-DataFrame (Spalten open/high/low/close), aufsteigend
    sortiert, DatetimeIndex."""
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    close = df["close"].to_numpy()
    times = df.index.to_numpy()
    n = len(df)

    ph_revealed = pivot_high(high, params.pivot_depth, params.pivot_depth)
    pl_revealed = pivot_low(low, params.pivot_depth, params.pivot_depth)

    zigzag: list[ZigzagPoint] = []
    signals: list[Signal] = []

    for t in range(n):
        events = []
        if not np.isnan(ph_revealed[t]):
            actual_idx = t - params.pivot_depth
            events.append(ZigzagPoint(actual_idx, high[actual_idx], "H"))
        if not np.isnan(pl_revealed[t]):
            actual_idx = t - params.pivot_depth
            events.append(ZigzagPoint(actual_idx, low[actual_idx], "L"))

        for point in events:
            if zigzag and zigzag[-1].kind == point.kind:
                more_extreme = (
                    point.price > zigzag[-1].price if point.kind == "H" else point.price < zigzag[-1].price
                )
                if more_extreme:
                    zigzag[-1] = point
                continue

            zigzag.append(point)

            if len(zigzag) >= 6:
                result = _check_impulse(zigzag[-6:], params)
                if result is not None:
                    direction, w2, w3, w4 = result
                    signals.append(
                        Signal(
                            time=times[t],
                            bar_index=t,
                            direction=direction,
                            entry_price=close[t],
                            wave5_price=zigzag[-1].price,
                            wave2_retrace=w2,
                            wave3_extension=w3,
                            wave4_retrace=w4,
                        )
                    )

    return signals


def signals_to_dataframe(signals: list[Signal]) -> pd.DataFrame:
    return pd.DataFrame([s.__dict__ for s in signals])
