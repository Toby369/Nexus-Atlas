"""Trade-Aufloesung + $-P&L fuer die Elliott-Wave-Reversal-Signale, unter
Verwendung von Tobys Setup-Exit-Logik (20x Hebel, FIX 10 USDT Marge/Trade,
SL 10% Marge, Trailing-Ruecksetzer 10% Marge ab TP-Beruehrung) -- 1:1
identische Ausfuehrungslogik wie research-python/avwap_pivot_setup/backtest.py.

Anders als beim AVWAP-Projekt (ein fest verdrahteter TP-Wert) wird hier fuer
JEDEN der 4 Toby-Setup-Standards (siehe config.py TOBY_STANDARDS) separat
simuliert -- "Toby Setup" ist mehrdeutig ohne Standard-Nummer, siehe
Korrektur 19.09.2026 in TOBY_SETUP_STANDARDS.py.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import BacktestParams, TobyStandard
from elliott_wave_engine import Signal


@dataclass
class Trade:
    signal_time: pd.Timestamp
    entry_time: pd.Timestamp
    direction: str
    entry_price: float
    exit_price: float
    exit_reason: str  # "sl" | "trail_exit" | "open_at_horizon" | "end_of_data"
    moved_to_breakeven: bool
    wave2_retrace: float
    wave3_extension: float
    wave4_retrace: float
    r_multiple_gross: float
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
    """Wie `_resolve_trade_exit_arrays`, nimmt aber ein DataFrame entgegen --
    bequem fuer Tests/Einzelaufrufe. `simulate_signals` (Hot Path) konvertiert
    stattdessen einmalig zu numpy-Arrays, siehe avwap_pivot_setup/backtest.py
    (dortiger Performance-Fix)."""
    return _resolve_trade_exit_arrays(
        df["high"].to_numpy(), df["low"].to_numpy(), df["close"].to_numpy(), df.index.to_numpy(),
        entry_idx, is_long, entry_price, tp_pct, sl_pct, retrace_pct, vertical_bars,
    )


def _resolve_trade_exit_arrays(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    times: np.ndarray,
    entry_idx: int,
    is_long: bool,
    entry_price: float,
    tp_pct: float,
    sl_pct: float,
    retrace_pct: float,
    vertical_bars: int,
):
    n = len(highs)
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
        real_exit = lows[touch_idx] if is_long else highs[touch_idx]
        mfe = (real_exit / entry_price - 1) * 100 if is_long else (1 - real_exit / entry_price) * 100
        return real_exit, "sl", times[touch_idx], False, mfe

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
    standard: TobyStandard,
    tf_minutes: int,
) -> list[Trade]:
    vertical_bars = _vertical_bars_for_timeframe(tf_minutes, bt_params.max_hold_hours)
    margin = 10.0
    lev = 20.0
    notional = margin * lev

    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()
    times = df.index.to_numpy()

    trades: list[Trade] = []
    equity = bt_params.initial_equity

    for sig in sorted(signals, key=lambda s: s.bar_index):
        is_long = sig.direction == "LONG"
        exit_price, reason, exit_time, moved_be, r_pct = _resolve_trade_exit_arrays(
            highs, lows, closes, times, sig.bar_index, is_long, sig.entry_price,
            standard.tp_pct, standard.sl_pct, standard.retrace_pct, vertical_bars,
        )

        gross_pnl = notional * (r_pct / 100.0)
        fee = notional * bt_params.fee_pct_per_side * 2
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
                wave2_retrace=sig.wave2_retrace,
                wave3_extension=sig.wave3_extension,
                wave4_retrace=sig.wave4_retrace,
                r_multiple_gross=r_pct / standard.sl_pct,
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
                "exit_reason", "moved_to_breakeven", "wave2_retrace", "wave3_extension",
                "wave4_retrace", "r_multiple_gross", "margin_usdt", "fee_usdt",
                "net_pnl_usdt", "equity_after_usdt",
            ]
        )
    return pd.DataFrame([t.__dict__ for t in trades])
