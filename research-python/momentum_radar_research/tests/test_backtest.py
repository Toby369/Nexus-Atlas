import numpy as np
import pandas as pd

from backtest import Path15m, bh_fdr, simulate


def _path(highs, lows, opens=None):
    n = len(highs)
    idx = pd.date_range("2025-03-01", periods=n, freq="15min", tz="UTC").as_unit("ns")
    opens = opens or [100.0] * n
    df = pd.DataFrame({"open": opens, "high": highs, "low": lows, "close": [100.0] * n}, index=idx)
    return Path15m.from_df(df), idx


def test_tp_hit_long():
    highs = [100.2] * 5 + [101.6] + [100.2] * 200
    lows = [99.8] * 206
    path, idx = _path(highs, lows)
    out, ret, _ = simulate(path, idx[0], 1)
    assert out == "TP" and ret == 0.015


def test_sl_wins_tie_in_same_bar():
    highs = [100.2] * 3 + [101.6] + [100.2] * 200
    lows = [99.8] * 3 + [99.4] + [99.8] * 200
    path, idx = _path(highs, lows)
    out, _, _ = simulate(path, idx[0], 1)
    assert out == "SL"


def test_short_mirrors_long():
    highs = [100.2] * 206
    lows = [99.8] * 4 + [98.4] + [99.8] * 201
    path, idx = _path(highs, lows)
    out, ret, _ = simulate(path, idx[0], -1)
    assert out == "TP" and ret == 0.015


def test_window_beyond_data_end_is_dropped():
    path, idx = _path([100.2] * 50, [99.8] * 50)
    assert simulate(path, idx[0], 1) is None


def test_bh_fdr():
    assert bh_fdr([0.001, 0.01, 0.04, 0.5]) == [True, True, False, False]
