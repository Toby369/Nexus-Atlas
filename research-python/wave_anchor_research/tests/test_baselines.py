import numpy as np
import pandas as pd
import pytest

from baselines import compute_all_baselines, ema_trend, macd, momentum, rsi


def test_momentum_hand_calculated():
    close = pd.Series([100.0, 102.0, 104.0, 108.0])
    mom = momentum(close, lookback_bars=2)
    assert mom.iloc[2] == pytest.approx(104.0 / 100.0 - 1.0)
    assert mom.iloc[3] == pytest.approx(108.0 / 102.0 - 1.0)
    assert mom.iloc[:2].isna().all()


def test_rsi_bounded_0_100_and_high_in_strong_uptrend():
    close = pd.Series(np.linspace(100, 200, 60))  # monotoner Aufwaertstrend
    r = rsi(close, period=14)
    valid = r.dropna()
    assert len(valid) > 0
    assert (valid >= 0).all() and (valid <= 100).all()
    # In einem reinen, verlustfreien Aufwaertstrend gibt es keine Verluste
    # (avg_loss=0) -> RSI muss sich 100 annaehern.
    assert valid.iloc[-1] > 95


def test_ema_trend_positive_in_uptrend_negative_in_downtrend():
    up = pd.Series(np.linspace(100, 200, 60))
    down = pd.Series(np.linspace(200, 100, 60))
    assert ema_trend(up).dropna().iloc[-1] > 0
    assert ema_trend(down).dropna().iloc[-1] < 0


def test_macd_hist_equals_macd_minus_signal():
    close = pd.Series(100 + np.sin(np.linspace(0, 20, 80)) * 10 + np.linspace(0, 5, 80))
    m = macd(close)
    diff = (m["macd"] - m["macd_signal"] - m["macd_hist"]).dropna()
    assert (diff.abs() < 1e-9).all()


def test_compute_all_baselines_returns_expected_columns():
    close = pd.Series(100 + np.sin(np.linspace(0, 20, 80)) * 10)
    df = pd.DataFrame({"open": close, "high": close + 1, "low": close - 1, "close": close})
    out = compute_all_baselines(df, momentum_lookback_bars=10)
    assert set(out.columns) == {"baseline_momentum", "baseline_ema_trend", "baseline_rsi", "baseline_macd_hist"}
    assert len(out) == len(df)
