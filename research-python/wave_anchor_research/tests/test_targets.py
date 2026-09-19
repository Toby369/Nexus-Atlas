import numpy as np
import pandas as pd
import pytest

from targets import compute_forward_return_targets, horizon_bars_for_timeframe


def _df() -> pd.DataFrame:
    close = np.arange(100, 110, dtype=float)  # 100..109
    idx = pd.date_range("2025-01-01", periods=len(close), freq="1h", tz="UTC")
    return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1, "close": close}, index=idx)


def test_forward_return_hand_calculated():
    df = _df()
    targets = compute_forward_return_targets(df, {"test": 3})
    # Index 0: close=100, future_close=close[3]=103 -> return=0.03
    assert targets["forward_return_test"].iloc[0] == pytest.approx(0.03)
    assert targets["direction_test"].iloc[0] == 1.0
    assert targets["abs_return_test"].iloc[0] == pytest.approx(0.03)


def test_mfe_mae_hand_calculated():
    df = _df()
    targets = compute_forward_return_targets(df, {"test": 3})
    # Index 0: high[1..3]=[102,103,104] -> mfe=(104/100)-1=0.04
    #          low[1..3]=[100,101,102] -> mae=(100/100)-1=0.0
    assert targets["mfe_test"].iloc[0] == pytest.approx(0.04)
    assert targets["mae_test"].iloc[0] == pytest.approx(0.0)


def test_last_bars_without_full_horizon_are_nan():
    df = _df()
    targets = compute_forward_return_targets(df, {"test": 3})
    assert targets["forward_return_test"].iloc[-3:].isna().all()
    assert targets["mfe_test"].iloc[-3:].isna().all()
    assert targets["forward_return_test"].iloc[:-3].notna().all()


def test_horizon_bars_for_15m_matches_hour_conversion():
    bars = horizon_bars_for_timeframe("15m")
    assert bars == {"1H": 4, "4H": 16, "12H": 48, "24H": 96, "48H": 192, "7D": 672}


def test_horizon_bars_for_1h_matches_hour_conversion():
    bars = horizon_bars_for_timeframe("1h")
    assert bars == {"1H": 1, "4H": 4, "12H": 12, "24H": 24, "48H": 48, "7D": 168}


def test_unknown_timeframe_raises():
    with pytest.raises(ValueError):
        horizon_bars_for_timeframe("3m")
