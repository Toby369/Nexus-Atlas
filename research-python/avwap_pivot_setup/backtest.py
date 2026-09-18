"""Trade-Aufloesung + $-P&L fuer die AVWAP-Pivot-Konfluenz-Signale, unter
Verwendung von Tobys EXAKTEM Setup (20x Hebel, FIX 10 USDT Marge je Trade,
SL 10%/TP 30% der Marge, Trailing-Ruecksetzer 10% Marge ab TP-Beruehrung).

Anders als beim "Toby Setup ungefiltert"-Baseline-Report (jede Kerze als
Signal, rein deskriptive Basisraten OHNE Kapitalverwaltung, da dort
Tausende ueberlappende hypothetische Positionen gleichzeitig offen waeren)
ist die Signalmenge hier durch die AVWAP-Konfluenz-Filterung deutlich
kleiner und seltener -- ein echter, sequenziell simulierter $-P&L-Verlauf
ist hier sinnvoll und wird deshalb (anders als beim Baseline-Report)
zusaetzlich gebaut.

Fixe Marge je Trade (nicht wie bei LSOB/OMS ein Prozentsatz des jeweils
aktuellen Equity) -- entspricht Tobys woertlicher Beschreibung "10 USDT
Einsatz" und macht den P&L-Verlauf ADDITIV statt multiplikativ
compoundierend. Das ist eine bewusste, dokumentierte Abweichung vom
LSOB/OMS-Muster (dort: 1% Risiko vom jeweiligen Equity).
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from avwap_engine import Signal
from config import BacktestParams


@dataclass
class Trade:
    signal_time: pd.Timestamp
    entry_time: pd.Timestamp
    direction: str
    entry_price: float
    exit_price: float
    exit_reason: str  # "sl" | "trail_exit" | "open_at_horizon" | "end_of_data"
    moved_to_breakeven: bool
    confluence_count: int
    r_multiple_gross: float  # preisbasiert, ohne Fees/Hebel
    margin_usdt: float
    fee_usdt: float
    net_pnl_usdt: float
    equity_after_usdt: float


def _vertical_bars_for_timeframe(tf_minutes: int, max_hold_hours: float) -> int:
    return int(round(max_hold_hours * 60 / tf_minutes))


def resolve_trade_exit(
    df: pd.DataFrame,
    entry_idx: int,
    is_long: bool,
    entry_price: float,
    tp_pct: float,
    sl_pct: float,
    retrace_pct: float,
    vertical_bars: int,
):
    """Identische Ausfuehrungs-Logik wie toby_setup_engine.run_toby_setup
    (SL/TP-Barrieren, danach Trailing-Ruecksetzer ab TP-Beruehrung), aber
    fuer einen EXPLIZIT VORGEGEBENEN Entry (Signal-Kerzen-Close) statt fuer
    jede Kerze -- Scan beginnt an der Kerze NACH dem Signal (kein Entry auf
    der Signal-Kerze selbst, sonst doppelte Verwendung derselben Kerze).
    """
    n = len(df)
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()
    times = df.index.to_numpy()

    window_end = min(entry_idx + 1 + vertical_bars, n)
    start = entry_idx + 1

    if is_long:
        tp_price = entry_price * (1 + tp_pct / 100.0)
        sl_price = entry_price * (1 - sl_pct / 100.0)
    else:
        tp_price = entry_price * (1 - tp_pct / 100.0)
        sl_price = entry_price * (1 + sl_pct / 100.0)

    touch_idx = None
    for j in range(start, window_end):
        if is_long:
            hit = highs[j] >= tp_price or lows[j] <= sl_price
        else:
            hit = lows[j] <= tp_price or highs[j] >= sl_price
        if hit:
            touch_idx = j
            break

    if touch_idx is None:
        last_idx = window_end - 1 if window_end > start else entry_idx
        return closes[last_idx], "end_of_data", times[last_idx], False, 0.0

    hit_sl = lows[touch_idx] <= sl_price if is_long else highs[touch_idx] >= sl_price
    if hit_sl:
        # Realistischer Fill: tatsaechliches Kerzentief/-hoch der ausloesenden
        # Kerze, NICHT der nominelle SL-Preis -- gleiche Konvention wie im
        # Toby-Setup-Baseline-Report (dort zentraler Befund: realistischer
        # Fill ist strukturell schlechter als der nominelle).
        real_exit = lows[touch_idx] if is_long else highs[touch_idx]
        mfe = (real_exit / entry_price - 1) * 100 if is_long else (1 - real_exit / entry_price) * 100
        return real_exit, "sl", times[touch_idx], False, mfe

    # Trailing ab touch_idx (inklusive). Bei retrace_pct < tp_pct (hier:
    # 0,5% < 1,5%) liegt der Trail-Exit-Preis immer noch ueber dem Entry --
    # "trail_exit" ist daher immer ein Gewinn, keine gesonderte
    # Breakeven-Kategorie noetig (anders als beim OMS-Projekt, das den SL
    # aktiv auf den Entry nachzieht statt vom Peak aus zurueckzumessen).
    peak = highs[touch_idx] if is_long else lows[touch_idx]
    for j in range(touch_idx, window_end):
        if is_long:
            if highs[j] > peak:
                peak = highs[j]
            if lows[j] <= peak * (1 - retrace_pct / 100.0):
                exit_price = peak * (1 - retrace_pct / 100.0)
                r = (exit_price / entry_price - 1) * 100
                return exit_price, "trail_exit", times[j], True, r
        else:
            if lows[j] < peak:
                peak = lows[j]
            if highs[j] >= peak * (1 + retrace_pct / 100.0):
                exit_price = peak * (1 + retrace_pct / 100.0)
                r = (1 - exit_price / entry_price) * 100
                return exit_price, "trail_exit", times[j], True, r

    last_idx = window_end - 1
    r = (peak / entry_price - 1) * 100 if is_long else (1 - peak / entry_price) * 100
    return peak, "open_at_horizon", times[last_idx], True, r


def simulate_signals(
    df: pd.DataFrame,
    signals: list[Signal],
    bt_params: BacktestParams,
    tf_minutes: int,
) -> list[Trade]:
    vertical_bars = _vertical_bars_for_timeframe(tf_minutes, bt_params.max_hold_hours)
    margin = 10.0  # USDT, Tobys fixer Einsatz je Trade (nicht % vom Equity)
    lev = 20.0  # Tobys fixer Hebel
    notional = margin * lev

    trades: list[Trade] = []
    equity = bt_params.initial_equity

    for sig in sorted(signals, key=lambda s: s.bar_index):
        is_long = sig.direction == "LONG"
        exit_price, reason, exit_time, moved_be, r_pct = resolve_trade_exit(
            df, sig.bar_index, is_long, sig.entry_price,
            bt_params.tp_pct, bt_params.sl_pct, bt_params.retrace_pct, vertical_bars,
        )

        gross_pnl = notional * (r_pct / 100.0)
        fee = notional * bt_params.fee_pct_per_side * 2  # Entry + Exit
        net_pnl = gross_pnl - fee
        equity += net_pnl

        trades.append(
            Trade(
                signal_time=sig.time,
                entry_time=sig.time,
                direction=sig.direction,
                entry_price=sig.entry_price,
                exit_price=exit_price,
                exit_reason=reason,
                moved_to_breakeven=moved_be,
                confluence_count=sig.confluence_count,
                r_multiple_gross=r_pct / bt_params.sl_pct,
                margin_usdt=margin,
                fee_usdt=fee,
                net_pnl_usdt=net_pnl,
                equity_after_usdt=equity,
            )
        )

    return trades


def trades_to_dataframe(trades: list[Trade]) -> pd.DataFrame:
    if not trades:
        return pd.DataFrame(
            columns=[
                "signal_time", "entry_time", "direction", "entry_price", "exit_price",
                "exit_reason", "moved_to_breakeven", "confluence_count", "r_multiple_gross",
                "margin_usdt", "fee_usdt", "net_pnl_usdt", "equity_after_usdt",
            ]
        )
    return pd.DataFrame([t.__dict__ for t in trades])
