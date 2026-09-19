"""Kennzahlen-Berechnung aus einer Trade-Liste (bereits nach Netto-$-PnL,
inkl. Fees). Gleiche Struktur wie in avwap_pivot_setup/metrics.py, um einen
zusaetzlichen Standard-Identifier erweitert (4 Toby-Standards je Bucket).
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backtest import Trade


@dataclass
class BucketMetrics:
    timeframe: str
    direction: str
    standard: int
    trades: int
    wins: int
    losses: int
    winrate_pct: float
    profit_factor: float
    avg_win_usdt: float
    avg_loss_usdt: float
    total_pnl_usdt: float
    total_return_pct: float
    max_drawdown_pct: float
    sharpe_per_trade: float
    avg_r_multiple_gross: float
    final_equity_usdt: float


def _max_drawdown_pct(equity_curve: np.ndarray) -> float:
    if len(equity_curve) == 0:
        return 0.0
    running_max = np.maximum.accumulate(equity_curve)
    drawdown = (equity_curve - running_max) / running_max
    return float(drawdown.min() * 100) if len(drawdown) else 0.0


def compute_bucket_metrics(
    timeframe: str, direction: str, standard: int, trades: list[Trade], initial_equity: float
) -> BucketMetrics:
    if not trades:
        return BucketMetrics(
            timeframe=timeframe, direction=direction, standard=standard, trades=0, wins=0, losses=0,
            winrate_pct=np.nan, profit_factor=np.nan, avg_win_usdt=np.nan, avg_loss_usdt=np.nan,
            total_pnl_usdt=0.0, total_return_pct=0.0, max_drawdown_pct=0.0, sharpe_per_trade=np.nan,
            avg_r_multiple_gross=np.nan, final_equity_usdt=initial_equity,
        )

    pnls = np.array([t.net_pnl_usdt for t in trades])
    wins = pnls[pnls > 0]
    losses = pnls[pnls <= 0]

    winrate = len(wins) / len(pnls) * 100
    gross_win = wins.sum() if len(wins) else 0.0
    gross_loss = abs(losses.sum()) if len(losses) else 0.0
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else np.inf if gross_win > 0 else np.nan

    avg_win = wins.mean() if len(wins) else np.nan
    avg_loss = losses.mean() if len(losses) else np.nan

    equity_curve = np.concatenate([[initial_equity], np.array([t.equity_after_usdt for t in trades])])
    final_equity = equity_curve[-1]
    total_pnl = pnls.sum()
    total_return = (final_equity / initial_equity - 1) * 100
    max_dd = _max_drawdown_pct(equity_curve)

    std = pnls.std(ddof=1) if len(pnls) > 1 else np.nan
    sharpe = pnls.mean() / std if std and std > 0 else np.nan

    avg_r = np.mean([t.r_multiple_gross for t in trades])

    return BucketMetrics(
        timeframe=timeframe, direction=direction, standard=standard, trades=len(trades),
        wins=len(wins), losses=len(losses), winrate_pct=winrate, profit_factor=profit_factor,
        avg_win_usdt=avg_win, avg_loss_usdt=avg_loss, total_pnl_usdt=total_pnl,
        total_return_pct=total_return, max_drawdown_pct=max_dd, sharpe_per_trade=sharpe,
        avg_r_multiple_gross=avg_r, final_equity_usdt=final_equity,
    )


def bucket_metrics_to_dataframe(metrics: list[BucketMetrics]) -> pd.DataFrame:
    return pd.DataFrame([m.__dict__ for m in metrics])
