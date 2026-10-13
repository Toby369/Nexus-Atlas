import numpy as np
import pandas as pd

from backtest import simulate
from config import CostParams, StrategyParams
from data_loader import normalize_klines, resample
from indicators import pivot_high, pivot_low
from signals import Setup, align_to_base
from volume_profile import profile_levels


def _base(n: int, start: str = "2024-01-01") -> pd.DatetimeIndex:
    return pd.date_range(start, periods=n, freq="15min", tz="UTC")


def test_align_uses_only_closed_htf_bars():
    base = _base(32)  # 8 Stunden
    htf = pd.DataFrame({"x": [1.0, 2.0]}, index=pd.date_range("2024-01-01", periods=2, freq="4h", tz="UTC"))
    aligned = align_to_base(htf, "4h", base)["x"]
    # Die 4h-Kerze 00:00-04:00 ist erst zum Close der 15m-Kerze 03:45 bekannt.
    assert aligned.iloc[:15].isna().all()
    assert aligned.loc["2024-01-01 03:45"] == 1.0
    assert aligned.loc["2024-01-01 07:30"] == 1.0
    assert aligned.loc["2024-01-01 07:45"] == 2.0


def test_pivots_are_revealed_after_right_bars():
    highs = np.array([1, 2, 3, 10, 3, 2, 1, 2, 3, 4, 3, 2, 1], dtype=float)
    revealed = pivot_high(highs, 2, 2)
    assert np.isnan(revealed[:5]).all()
    assert revealed[5] == 10
    assert revealed[11] == 4
    lows = -highs
    assert pivot_low(lows, 2, 2)[5] == -10


def test_resample_drops_incomplete_bars():
    idx = _base(20)  # 5 Stunden -> nur 1 volle 4h-Kerze
    df = pd.DataFrame(
        {"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 1.0, "taker_buy": 0.6, "delta": 0.2},
        index=idx,
    )
    out = resample(df, "4h")
    assert len(out) == 1
    assert out["volume"].iloc[0] == 16.0


def test_normalize_klines_handles_microseconds_and_delta():
    ms = pd.Timestamp("2024-12-31 23:45", tz="UTC").value // 10**6
    us = pd.Timestamp("2025-01-01 00:00", tz="UTC").value // 10**3
    raw = pd.DataFrame(
        {"open_time": [ms, us], "open": [1, 1], "high": [2, 2], "low": [0, 0], "close": [1, 1],
         "volume": [10, 10], "taker_buy": [7, 2]}
    )
    out = normalize_klines(raw)
    assert list(out.index) == [pd.Timestamp("2024-12-31 23:45", tz="UTC"), pd.Timestamp("2025-01-01", tz="UTC")]
    assert list(out["delta"]) == [4.0, -6.0]


def test_profile_poc_and_value_area():
    low = np.array([100.0, 100.0, 100.0, 109.0])
    high = np.array([101.0, 101.0, 101.0, 110.0])
    vol = np.array([10.0, 10.0, 10.0, 1.0])
    poc, vah, val = profile_levels(low, high, vol, bins=10, value_area=0.7)
    assert 100 <= poc <= 101
    assert val <= poc <= vah
    assert vah <= 102


def _setup(bar: int, stop: float) -> Setup:
    return Setup(bar=bar, direction=1, stop=stop, trend=True, zone=True, momentum=True, cvd=True,
                 vol_spike=True, targets=())


def test_stop_wins_when_bar_hits_both():
    idx = _base(5)
    df = pd.DataFrame({"open": [100, 100, 100, 100, 100], "high": [101, 101, 130, 101, 101],
                       "low": [99, 99, 80, 99, 99], "close": [100] * 5}, index=idx, dtype=float)
    costs = CostParams(fee_pct_per_side=0.0, slippage_pct_per_side=0.0)
    trades = simulate(df, [_setup(0, 95.0)], lambda s: True, "fixed", StrategyParams(), costs)
    assert trades["reason"].iloc[0] == "stop"
    assert trades["r"].iloc[0] == -1.0


def test_target_hit_gives_fixed_rr_minus_costs():
    idx = _base(5)
    df = pd.DataFrame({"open": [100] * 5, "high": [101, 101, 111, 101, 101],
                       "low": [99, 99, 99, 99, 99], "close": [100] * 5}, index=idx, dtype=float)
    p = StrategyParams()
    trades = simulate(df, [_setup(0, 95.0)], lambda s: True, "fixed", p, CostParams())
    assert trades["reason"].iloc[0] == "tp"
    expected_cost = (0.0005 + 0.0002) * (100 + 110) / 5
    assert np.isclose(trades["r"].iloc[0], 2.0 - expected_cost)
