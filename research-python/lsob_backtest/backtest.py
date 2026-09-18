"""Trade-Simulation: SL/TP-Aufloesung, Fees, Equity-Kurve pro Bucket
(Timeframe x Richtung). Alles hier ist NICHT im Pine-Skript enthalten (siehe
config.py) -- eigene, dokumentierte Backtest-Annahmen.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import BacktestParams
from lsob_engine import Signal


@dataclass
class Trade:
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    direction: str
    entry_price: float
    sl_price: float
    tp_price: float
    exit_price: float
    exit_reason: str  # "sl" | "tp" | "end_of_data"
    risk_price_distance: float
    r_multiple_gross: float  # (exit-entry)/risk, Vorzeichen-korrigiert, VOR Fees
    equity_before: float
    equity_after: float
    net_pnl: float
    net_return_pct: float  # net_pnl / equity_before


def _resolve_exit(df: pd.DataFrame, entry_idx: int, is_long: bool, sl: float, tp: float):
    """Sucht ab der Bar NACH dem Entry die erste Bar, die SL oder TP
    beruehrt. Treffen beide in derselben Bar, wird konservativ SL
    angenommen (nicht bekannt, welches Level intrabar zuerst erreicht
    wurde) -- siehe README "Methodische Annahmen".
    """
    n = len(df)
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()
    times = df.index.to_numpy()

    for j in range(entry_idx + 1, n):
        h, l = highs[j], lows[j]
        if is_long:
            hit_sl = l <= sl
            hit_tp = h >= tp
        else:
            hit_sl = h >= sl
            hit_tp = l <= tp

        if hit_sl:
            return sl, "sl", times[j]
        if hit_tp:
            return tp, "tp", times[j]

    return closes[-1], "end_of_data", times[-1]


def simulate_bucket(df: pd.DataFrame, signals: list[Signal], params: BacktestParams) -> list[Trade]:
    """Simuliert alle Signale EINER Richtung (long ODER short, bereits von
    aussen gefiltert) sequenziell nach Entry-Zeit, mit prozentualer
    Risiko-Positionsgroesse auf das jeweils aktuelle Equity dieses Buckets.
    Jeder Bucket startet unabhaengig bei params.initial_equity -- siehe
    README, Limitation "getrennte Kapitalpools".
    """
    trades: list[Trade] = []
    equity = params.initial_equity

    for sig in sorted(signals, key=lambda s: s.bar_index):
        is_long = sig.direction == "long"
        sl_buffer = sig.entry_price * params.sl_buffer_pc / 100
        sl = sig.sl_price - sl_buffer if is_long else sig.sl_price + sl_buffer
        risk_dist = abs(sig.entry_price - sl)
        if risk_dist <= 0:
            continue  # degenerierter Fall (SL == Entry), kein gueltiger Trade

        reward_dist = risk_dist * params.crv
        tp = sig.entry_price + reward_dist if is_long else sig.entry_price - reward_dist

        exit_price, exit_reason, exit_time = _resolve_exit(df, sig.bar_index, is_long, sl, tp)

        risk_amount = equity * params.risk_per_trade_pct / 100
        position_size = risk_amount / risk_dist

        gross_pnl = position_size * (exit_price - sig.entry_price) * (1 if is_long else -1)
        entry_fee = position_size * sig.entry_price * params.fee_pct_per_side
        exit_fee = position_size * exit_price * params.fee_pct_per_side
        net_pnl = gross_pnl - entry_fee - exit_fee

        r_multiple_gross = (exit_price - sig.entry_price) / risk_dist * (1 if is_long else -1)

        equity_before = equity
        equity += net_pnl

        trades.append(
            Trade(
                entry_time=sig.time,
                exit_time=exit_time,
                direction=sig.direction,
                entry_price=sig.entry_price,
                sl_price=sl,
                tp_price=tp,
                exit_price=exit_price,
                exit_reason=exit_reason,
                risk_price_distance=risk_dist,
                r_multiple_gross=r_multiple_gross,
                equity_before=equity_before,
                equity_after=equity,
                net_pnl=net_pnl,
                net_return_pct=net_pnl / equity_before if equity_before else np.nan,
            )
        )

    return trades


def trades_to_dataframe(trades: list[Trade]) -> pd.DataFrame:
    if not trades:
        return pd.DataFrame(
            columns=[
                "entry_time", "exit_time", "direction", "entry_price", "sl_price", "tp_price",
                "exit_price", "exit_reason", "risk_price_distance", "r_multiple_gross",
                "equity_before", "equity_after", "net_pnl", "net_return_pct",
            ]
        )
    return pd.DataFrame([t.__dict__ for t in trades])
