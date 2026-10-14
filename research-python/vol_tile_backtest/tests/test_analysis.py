import numpy as np
import pandas as pd
import pytest

from vol_tile_backtest.analysis import build_daily, coverage_columns, realized_vol


def hourly(n_days: int, seed: int = 0, vol: float = 0.01) -> pd.Series:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-01 01:00", periods=n_days * 24, freq="1h", tz="UTC")
    return pd.Series(100 * np.exp(np.cumsum(rng.normal(0, vol, len(idx)))), index=idx)


def dvol_series(closes: pd.Series, value: float = 50.0) -> pd.Series:
    days = pd.date_range(closes.index[0].normalize() + pd.Timedelta(days=1), closes.index[-1].normalize(), freq="D")
    return pd.Series(value, index=days)


def test_realized_vol_matches_tile_formula():
    r = np.array([0.01, -0.01, 0.02, -0.005])
    assert realized_vol(r) == pytest.approx(np.std(r, ddof=1) * np.sqrt(24 * 365) * 100)


def test_alignment_uses_close_at_midnight():
    closes = hourly(40)
    daily = build_daily(dvol_series(closes), closes)
    t = daily.index[0]
    assert daily.loc[t, "price"] == closes.loc[t]  # Schluss der Kerze 23:00-00:00
    assert daily.loc[t, "p_1"] == closes.loc[t + pd.Timedelta(days=1)]


def test_backward_values_do_not_use_future():
    closes = hourly(80, seed=1)
    base = build_daily(dvol_series(closes), closes)
    changed = closes.copy()
    cut = base.index[40]
    changed[changed.index > cut] *= 3.0  # Zukunft verzerren
    after = build_daily(dvol_series(changed), changed)
    for col in ("dvol", "price", "rv_back", "pct"):
        pd.testing.assert_series_equal(base.loc[:cut, col], after.loc[:cut, col])


def test_coverage_near_68_percent_for_matching_vol():
    # Stuendliche Std 0.01 -> annualisiert ~93.6 %; DVOL passend -> Trefferquote ~68 %
    closes = hourly(800, seed=2, vol=0.01)
    sigma = 0.01 * np.sqrt(24 * 365) * 100
    daily = coverage_columns(build_daily(dvol_series(closes, sigma), closes))
    assert daily["hit_1"].mean() == pytest.approx(0.683, abs=0.04)
    assert (daily["z_1"] ** 2).mean() == pytest.approx(1.0, abs=0.12)
