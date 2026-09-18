import pandas as pd
import pytest

from backtest import Trade
from metrics import compute_bucket_metrics


def _make_trade(i: int, equity_before: float, net_pnl: float) -> Trade:
    t0 = pd.Timestamp("2025-01-01", tz="UTC")
    return Trade(
        signal_time=t0 + pd.Timedelta(hours=i),
        entry_time=t0 + pd.Timedelta(hours=i),
        direction="LONG",
        entry_price=100.0,
        exit_price=100.0 + net_pnl,
        exit_reason="tp_running" if net_pnl > 0 else "sl",
        moved_to_breakeven=False,
        confluence_count=1,
        r_multiple_gross=net_pnl / 10,
        margin_usdt=10.0,
        fee_usdt=0.24,
        net_pnl_usdt=net_pnl,
        equity_after_usdt=equity_before + net_pnl,
    )


def test_compute_bucket_metrics_hand_calculated():
    deltas = [10, -5, 15, -30, 5]
    trades = []
    equity = 100.0
    for i, d in enumerate(deltas):
        trades.append(_make_trade(i, equity, d))
        equity += d

    m = compute_bucket_metrics("15m", "LONG", trades, initial_equity=100.0)

    assert m.trades == 5
    assert m.wins == 3
    assert m.losses == 2
    assert m.winrate_pct == pytest.approx(60.0)
    assert m.profit_factor == pytest.approx(30 / 35)
    assert m.avg_win_usdt == pytest.approx(10.0)
    assert m.avg_loss_usdt == pytest.approx(-17.5)
    assert m.total_pnl_usdt == pytest.approx(-5.0)
    assert m.total_return_pct == pytest.approx(-5.0)
    assert m.max_drawdown_pct == pytest.approx(-25.0, abs=0.01)
    assert m.final_equity_usdt == pytest.approx(95.0)


def test_compute_bucket_metrics_empty():
    m = compute_bucket_metrics("1h", "SHORT", [], initial_equity=1000.0)
    assert m.trades == 0
    assert m.total_return_pct == 0.0
    assert m.final_equity_usdt == 1000.0


def test_profit_factor_infinite_when_no_losses():
    trades = [_make_trade(0, 100.0, 10.0), _make_trade(1, 110.0, 5.0)]
    m = compute_bucket_metrics("5m", "LONG", trades, initial_equity=100.0)
    assert m.profit_factor == float("inf")
    assert m.winrate_pct == pytest.approx(100.0)
