"""1:1-Port der LSOB-Kernlogik aus LSOB_Rekonstruktion.pine (Zeilen
"PIVOTS & LIQUIDITY SWEEP" + "ORDER BLOCK STRUKTUR"). Pre-Warn-Linie und Fair
Value Gaps sind rein visuelle/Alert-Elemente ohne Einfluss auf das
Entry-Signal (sigEntry) und werden hier bewusst NICHT nachgebaut -- siehe
README, Abschnitt "Was nicht portiert wurde".

Bar-fuer-Bar-Simulation (kein Vektor-Code) -- das Pine-Skript ist selbst
zustandsbehaftet und bar-sequenziell (var-Arrays, box.set_right etc.), ein
Vektor-Ansatz wuerde das Risiko subtiler Abweichungen vom Original stark
erhoehen. Bei den hier relevanten Datenmengen (max. ~35k Bars fuer 15m/12
Monate) ist eine reine Python-Schleife performant genug.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import LsobParams
from pivots import pivot_high, pivot_low


@dataclass
class OrderBlock:
    top: float
    bottom: float
    is_long: bool
    confirmed: bool
    created_bar: int
    created_time: pd.Timestamp


@dataclass
class Signal:
    time: pd.Timestamp
    bar_index: int
    direction: str  # "long" | "short"
    entry_price: float  # Close der Confirmation-Kerze
    sl_price: float  # Wick-Extrempunkt (low fuer long, high fuer short) derselben Kerze
    ob_created_time: pd.Timestamp
    ob_top: float
    ob_bottom: float


def _forward_fill_pivots(revealed: np.ndarray) -> np.ndarray:
    """Entspricht Pines `var float lastPH = na; if not na(ph): lastPH := ph`
    -- der zuletzt bestaetigte Pivot bleibt gueltig, bis ein neuer kommt.
    """
    s = pd.Series(revealed)
    return s.ffill().to_numpy()


def run_lsob(df: pd.DataFrame, params: LsobParams) -> list[Signal]:
    """df: DataFrame mit Spalten open/high/low/close, aufsteigend sortiert,
    Index = Zeitstempel. Liefert alle Entry-Signale in chronologischer
    Reihenfolge.
    """
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    close = df["close"].to_numpy()
    open_ = df["open"].to_numpy()
    times = df.index.to_numpy()
    n = len(df)

    ph_revealed = pivot_high(high, params.pivot_len, params.pivot_len)
    pl_revealed = pivot_low(low, params.pivot_len, params.pivot_len)
    last_ph = _forward_fill_pivots(ph_revealed)
    last_pl = _forward_fill_pivots(pl_revealed)

    ob_list: list[OrderBlock] = []
    signals: list[Signal] = []

    for i in range(n):
        h, l, c, o = high[i], low[i], close[i], open_[i]
        lph, lpl = last_ph[i], last_pl[i]

        # ---- Liquidity Sweep (Zeilen "sweepHigh"/"sweepLow") ----
        sweep_high = not np.isnan(lph) and h > lph and c < lph
        sweep_low = not np.isnan(lpl) and l < lpl and c > lpl

        # ---- Neue Order Blocks (VOR der Management-Schleife erzeugt --
        # exakt wie im Pine-Skript, dadurch koennen frisch erzeugte OBs
        # noch in DERSELBEN Bar unten mitgeprueft werden). ----
        if sweep_low:
            ob_list.append(
                OrderBlock(top=h, bottom=l, is_long=True, confirmed=False, created_bar=i, created_time=times[i])
            )
        if sweep_high:
            ob_list.append(
                OrderBlock(top=h, bottom=l, is_long=False, confirmed=False, created_bar=i, created_time=times[i])
            )

        # ---- Bestehende Order Blocks verwalten ----
        still_active: list[OrderBlock] = []
        for ob in ob_list:
            box_height = ob.top - ob.bottom
            age = i - ob.created_bar

            if age > params.max_history_bars:
                continue  # Ablauf -> verworfen

            inval_tol = box_height * params.box_invalid_tol_pc / 100
            if ob.is_long:
                invalidated = (l < ob.bottom - inval_tol) if params.strict_wick_inval else (c < ob.bottom - inval_tol)
            else:
                invalidated = (h > ob.top + inval_tol) if params.strict_wick_inval else (c > ob.top + inval_tol)

            if not invalidated and box_height > 0:
                if ob.is_long:
                    pen = (ob.top - l) / box_height * 100
                    if l < ob.bottom and pen > params.max_wick_pen_pc:
                        invalidated = True
                else:
                    pen = (h - ob.bottom) / box_height * 100
                    if h > ob.top and pen > params.max_wick_pen_pc:
                        invalidated = True

            if invalidated:
                continue  # verworfen, KEIN Retest-Check mehr diese Bar (siehe Pine "continue")

            # ---- Retest + Rejection + Confirmation (nur falls noch nicht
            # bestaetigt) -- ALLE drei Bedingungen auf DERSELBEN Bar, siehe
            # README "Wichtige Erkenntnis beim Portieren". ----
            if not ob.confirmed:
                retest_tol = box_height * params.retest_tol_pc / 100
                if ob.is_long:
                    retested = (l <= ob.top + retest_tol) and (l >= ob.bottom - retest_tol)
                    rejection = (l < ob.top) and (c > ob.bottom)
                else:
                    retested = (h >= ob.bottom - retest_tol) and (h <= ob.top + retest_tol)
                    rejection = (h > ob.bottom) and (c < ob.top)

                if retested and rejection:
                    confirm_candle = (c > o) if ob.is_long else (c < o)
                    if confirm_candle:
                        ob.confirmed = True
                        signals.append(
                            Signal(
                                time=times[i],
                                bar_index=i,
                                direction="long" if ob.is_long else "short",
                                entry_price=c,
                                sl_price=l if ob.is_long else h,
                                ob_created_time=ob.created_time,
                                ob_top=ob.top,
                                ob_bottom=ob.bottom,
                            )
                        )

            still_active.append(ob)

        ob_list = still_active

    return signals
