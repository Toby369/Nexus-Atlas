"""Kennzahlen-Berechnung aus einer Trade-Liste (bereits nach Netto-PnL,
inkl. Fees). Alle Prozent-Werte als reine Zahl (z.B. 12.5 fuer 12.5%), nicht
als Bruch.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backtest import Trade


@dataclass
class BucketMetrics:
    timeframe: str
    direction: str
    trades: int
    wins: int
    losses: int
    winrate_pct: float
    profit_factor: float
    avg_win: float
    avg_loss: float
    total_return_pct: float
    max_drawdown_pct: float
    sharpe_per_trade: float
    sharpe_annualized_approx: float
    final_equity: float


def _max_drawdown_pct(equity_curve: np.ndarray) -> float:
    if len(equity_curve) == 0:
        return 0.0
    running_max = np.maximum.accumulate(equity_curve)
    drawdown = (equity_curve - running_max) / running_max
    return float(drawdown.min() * 100) if len(drawdown) else 0.0


def compute_bucket_metrics(
    timeframe: str,
    direction: str,
    trades: list[Trade],
    initial_equity: float,
) -> BucketMetrics:
    if not trades:
        return BucketMetrics(
            timeframe=timeframe, direction=direction, trades=0, wins=0, losses=0,
            winrate_pct=np.nan, profit_factor=np.nan, avg_win=np.nan, avg_loss=np.nan,
            total_return_pct=0.0, max_drawdown_pct=0.0, sharpe_per_trade=np.nan,
            sharpe_annualized_approx=np.nan, final_equity=initial_equity,
        )

    pnls = np.array([t.net_pnl for t in trades])
    returns = np.array([t.net_return_pct for t in trades])
    wins = pnls[pnls > 0]
    losses = pnls[pnls <= 0]

    winrate = len(wins) / len(pnls) * 100
    gross_win = wins.sum() if len(wins) else 0.0
    gross_loss = abs(losses.sum()) if len(losses) else 0.0
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else np.inf if gross_win > 0 else np.nan

    avg_win = wins.mean() if len(wins) else np.nan
    avg_loss = losses.mean() if len(losses) else np.nan

    equity_curve = np.concatenate([[initial_equity], np.array([t.equity_after for t in trades])])
    final_equity = equity_curve[-1]
    total_return = (final_equity / initial_equity - 1) * 100
    max_dd = _max_drawdown_pct(equity_curve)

    # Sharpe pro Trade (nicht annualisiert): Mittelwert/Standardabweichung
    # der Netto-Rendite pro Trade. Bei irregulaeren Trade-Abstaenden ist
    # eine klassische, auf gleichmaessige Zeitschritte kalibrierte Sharpe-
    # Definition nur eine Naeherung -- siehe README "Kritische Einordnung".
    std = returns.std(ddof=1) if len(returns) > 1 else np.nan
    sharpe_per_trade = returns.mean() / std if std and std > 0 else np.nan

    # Grobe Annualisierung: skaliert mit sqrt(Trades pro Jahr), basierend
    # auf der beobachteten Trade-Frequenz in diesem Bucket -- eine von
    # mehreren moeglichen Konventionen, kein Standard.
    span_bars = trades[-1].exit_time - trades[0].entry_time
    span_years = max(span_bars / np.timedelta64(365, "D"), 1e-9)
    trades_per_year = len(trades) / span_years
    sharpe_annualized = sharpe_per_trade * np.sqrt(trades_per_year) if not np.isnan(sharpe_per_trade) else np.nan

    return BucketMetrics(
        timeframe=timeframe,
        direction=direction,
        trades=len(trades),
        wins=len(wins),
        losses=len(losses),
        winrate_pct=winrate,
        profit_factor=profit_factor,
        avg_win=avg_win,
        avg_loss=avg_loss,
        total_return_pct=total_return,
        max_drawdown_pct=max_dd,
        sharpe_per_trade=sharpe_per_trade,
        sharpe_annualized_approx=sharpe_annualized,
        final_equity=final_equity,
    )


def bucket_metrics_to_dataframe(metrics: list[BucketMetrics]) -> pd.DataFrame:
    return pd.DataFrame([m.__dict__ for m in metrics])
