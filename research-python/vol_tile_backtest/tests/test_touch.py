import numpy as np
import pandas as pd
import pytest

from vol_tile_backtest.analysis import build_daily, coverage_columns
from vol_tile_backtest.touch import build_touch, model_touch_any, model_touch_one_side


def ohlc(n_days: int, seed: int = 0, vol: float = 0.01) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-01", periods=n_days * 24, freq="1h", tz="UTC")
    close = 100 * np.exp(np.cumsum(rng.normal(0, vol, len(idx))))
    open_ = np.r_[100, close[:-1]]
    wiggle = np.exp(np.abs(rng.normal(0, vol / 2, len(idx))))
    return pd.DataFrame({"high": np.maximum(open_, close) * wiggle,
                         "low": np.minimum(open_, close) / wiggle, "close": close}, index=idx)


def dvol(df: pd.DataFrame, value: float = 50.0) -> pd.Series:
    days = pd.date_range(df.index[0] + pd.Timedelta(days=1), df.index[-1].normalize(), freq="D")
    return pd.Series(value, index=days)


def test_model_reference_values():
    assert model_touch_one_side() == pytest.approx(0.3173, abs=1e-4)
    assert model_touch_any() == pytest.approx(0.6292, abs=1e-3)


def test_end_inside_matches_main_backtest():
    df = ohlc(60)
    touch = build_touch(dvol(df), df)
    closes = pd.Series(df["close"].to_numpy(), index=df.index + pd.Timedelta(hours=1))
    cov = coverage_columns(build_daily(dvol(df), closes))
    common = touch.dropna(subset=["end_in_7"]).index
    pd.testing.assert_series_equal(touch.loc[common, "end_in_7"], cov.loc[common, "hit_7"], check_names=False)


def test_touch_uses_only_window_and_flags_correctly():
    df = ohlc(20, seed=3)
    t = df.index[0] + pd.Timedelta(days=5)
    flat = df.copy()
    flat[["high", "low", "close"]] = 100.0
    flat.loc[t + pd.Timedelta(hours=5), "high"] = 200.0  # Spitze im 1-Tages-Fenster
    flat.loc[t + pd.Timedelta(days=1), "low"] = 1.0  # erst nach dem 1-Tages-Fenster
    r = build_touch(pd.Series(50.0, index=[t]), flat).loc[t]
    assert r["up_1"] == 1 and r["down_1"] == 0 and r["any_1"] == 1 and r["end_in_1"] == 1
    assert r["down_7"] == 1 and r["both_7"] == 1
    assert r["over_1"] > 0
