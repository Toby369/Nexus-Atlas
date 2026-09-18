import math

import numpy as np
import pandas as pd
import pytest

from backtest import Trade
from crv_walk_forward import N_SPLITS, purge_boundary_crossing, run_crv_walk_forward, select_best_crv
from lsob_engine import Signal


def _make_trade(exit_time: pd.Timestamp, net_pnl: float = 10.0) -> Trade:
    t0 = pd.Timestamp("2025-01-01", tz="UTC")
    return Trade(
        entry_time=t0, exit_time=exit_time, direction="long", entry_price=100.0, sl_price=95.0,
        tp_price=110.0, exit_price=105.0, exit_reason="tp", risk_price_distance=5.0,
        r_multiple_gross=1.0, equity_before=100.0, equity_after=100.0 + net_pnl, net_pnl=net_pnl,
        net_return_pct=net_pnl / 100.0,
    )


# --- purge_boundary_crossing -------------------------------------------------


def test_purge_keeps_trades_resolved_before_train_end():
    train_end = pd.Timestamp("2025-01-10", tz="UTC")
    inside = _make_trade(pd.Timestamp("2025-01-09", tz="UTC"))
    at_boundary = _make_trade(train_end)
    outside = _make_trade(pd.Timestamp("2025-01-11", tz="UTC"))

    kept = purge_boundary_crossing([inside, at_boundary, outside], train_end)
    assert kept == [inside, at_boundary]


def test_purge_empty_input():
    assert purge_boundary_crossing([], pd.Timestamp("2025-01-01", tz="UTC")) == []


# --- select_best_crv ----------------------------------------------------------


def test_select_best_crv_picks_highest_return():
    assert select_best_crv({1.5: 3.0, 2.0: 10.0, 3.0: -5.0}) == 2.0


def test_select_best_crv_falls_back_when_all_nan():
    assert select_best_crv({1.5: float("nan"), 2.0: float("nan"), 3.0: float("nan")}, fallback=2.0) == 2.0


def test_select_best_crv_ignores_nan_candidates():
    assert select_best_crv({1.5: float("nan"), 2.0: 4.0, 3.0: float("nan")}) == 2.0


# --- run_crv_walk_forward (Struktur + Equity-Chaining) -----------------------


def _flat_df_with_tp_spikes(n: int, spike_bars: dict[int, float]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=n, freq="1h", tz="UTC")
    high = np.full(n, 1000.0)
    for bar, value in spike_bars.items():
        high[bar] = value
    return pd.DataFrame(
        {"open": np.full(n, 1000.0), "high": high, "low": np.full(n, 1000.0), "close": np.full(n, 1000.0)},
        index=idx,
    )


def test_fold_boundaries_are_chronological_and_non_overlapping():
    n = 100
    df = _flat_df_with_tp_spikes(n, {})
    result = run_crv_walk_forward(df, [], timeframe="1h", direction="long")

    assert len(result.folds) == N_SPLITS
    for f in result.folds:
        assert f.train_end <= f.test_start
        assert f.test_start < f.test_end
    for prev, curr in zip(result.folds, result.folds[1:]):
        assert prev.test_end <= curr.test_start


def test_no_train_signals_falls_back_to_neutral_crv_every_fold():
    n = 100
    df = _flat_df_with_tp_spikes(n, {})
    result = run_crv_walk_forward(df, [], timeframe="1h", direction="long")
    assert all(f.selected_crv == 2.0 for f in result.folds)
    assert all(math.isnan(v) for f in result.folds for v in f.is_return_pct_by_crv.values())


def test_equity_chains_continuously_across_folds():
    n = 100
    idx = pd.date_range("2025-01-01", periods=n, freq="1h", tz="UTC")
    # Ein Signal je Test-Fenster der ersten drei Folds (Grenzen siehe
    # crv_walk_forward.py-Herleitung: test0=[25,40), test1=[40,55), test2=[55,70)),
    # jeweils mit TP-Treffer wenige Bars nach Entry.
    df = _flat_df_with_tp_spikes(n, {28: 1025.0, 43: 1025.0, 58: 1025.0})

    signals = [
        Signal(time=idx[26], bar_index=26, direction="long", entry_price=1000.0, sl_price=990.0,
               ob_created_time=idx[26], ob_top=1000.0, ob_bottom=990.0),
        Signal(time=idx[41], bar_index=41, direction="long", entry_price=1000.0, sl_price=990.0,
               ob_created_time=idx[41], ob_top=1000.0, ob_bottom=990.0),
        Signal(time=idx[56], bar_index=56, direction="long", entry_price=1000.0, sl_price=990.0,
               ob_created_time=idx[56], ob_top=1000.0, ob_bottom=990.0),
    ]

    result = run_crv_walk_forward(df, signals, timeframe="1h", direction="long")

    fold0, fold1, fold2 = result.folds[0], result.folds[1], result.folds[2]
    assert len(fold0.oos_trades) == 1
    assert len(fold1.oos_trades) == 1
    assert len(fold2.oos_trades) == 1

    # Equity läuft durch: Start von Fold 1 = Ende von Fold 0, nicht neu bei initial_equity.
    assert fold1.oos_trades[0].equity_before == pytest.approx(fold0.oos_trades[0].equity_after)
    assert fold2.oos_trades[0].equity_before == pytest.approx(fold1.oos_trades[0].equity_after)
    # Alle drei Trades sind profitabel (TP getroffen) -> Equity strikt steigend.
    assert fold0.oos_trades[0].equity_after > fold0.oos_trades[0].equity_before

    assert result.oos_trades_chained == fold0.oos_trades + fold1.oos_trades + fold2.oos_trades + result.folds[3].oos_trades
