import pandas as pd
import pytest

from backtest import Trade
from metrics import compute_bucket_metrics


def _make_trade(i: int, equity_before: float, net_pnl: float) -> Trade:
    t0 = pd.Timestamp("2025-01-01", tz="UTC")
    return Trade(
        entry_time=t0 + pd.Timedelta(minutes=i),
        exit_time=t0 + pd.Timedelta(minutes=i + 1),
        direction="long",
        entry_price=100.0,
        sl_price=95.0,
        tp_price=110.0,
        exit_price=100.0 + net_pnl / 20,
        exit_reason="tp" if net_pnl > 0 else "sl",
        moved_to_breakeven=False,
        risk_price_distance=5.0,
        r_multiple_gross=net_pnl / 100,
        equity_before=equity_before,
        equity_after=equity_before + net_pnl,
        net_pnl=net_pnl,
        net_return_pct=net_pnl / equity_before,
    )


def test_compute_bucket_metrics_hand_calculated():
    # Equity-Verlauf: 100 -> 110 -> 105 -> 120 -> 90 -> 95 (Deltas: +10,-5,+15,-30,+5)
    deltas = [10, -5, 15, -30, 5]
    trades = []
    equity = 100.0
    for i, d in enumerate(deltas):
        trades.append(_make_trade(i, equity, d))
        equity += d

    m = compute_bucket_metrics("1m", "long", trades, initial_equity=100.0)

    assert m.trades == 5
    assert m.wins == 3
    assert m.losses == 2
    assert m.winrate_pct == pytest.approx(60.0)
    assert m.profit_factor == pytest.approx(30 / 35)
    assert m.avg_win == pytest.approx(10.0)
    assert m.avg_loss == pytest.approx(-17.5)
    assert m.total_return_pct == pytest.approx(-5.0)
    assert m.max_drawdown_pct == pytest.approx(-25.0, abs=0.01)
    assert m.final_equity == pytest.approx(95.0)


def test_compute_bucket_metrics_empty():
    m = compute_bucket_metrics("5m", "short", [], initial_equity=1000.0)
    assert m.trades == 0
    assert m.total_return_pct == 0.0
    assert m.max_drawdown_pct == 0.0
    assert m.final_equity == 1000.0


def test_profit_factor_infinite_when_no_losses():
    trades = [_make_trade(0, 100.0, 10.0), _make_trade(1, 110.0, 5.0)]
    m = compute_bucket_metrics("1m", "long", trades, initial_equity=100.0)
    assert m.profit_factor == float("inf")
    assert m.winrate_pct == pytest.approx(100.0)
