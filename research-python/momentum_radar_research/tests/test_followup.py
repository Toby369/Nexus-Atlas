import numpy as np
import pandas as pd

from backtest import Path15m, simulate_limit
from radar import radar_signals, secondary_signals
from vwap_vector import nearest_level, vwap_levels
from tests.test_radar import _frames


def _path(highs, lows, opens):
    idx = pd.date_range("2025-03-01", periods=len(highs), freq="15min", tz="UTC").as_unit("ns")
    df = pd.DataFrame({"open": opens, "high": highs, "low": lows, "close": opens}, index=idx)
    return Path15m.from_df(df), idx


def test_limit_fills_at_level_then_tp():
    n = 300
    opens = [100.0] * n
    highs = [100.1] * n
    lows = [99.9] * n
    lows[3] = 98.9  # erreicht Level 99.0
    highs[10] = 100.6  # 99.0 * 1.015 = 100.485 -> TP
    path, idx = _path(highs, lows, opens)
    out, ret, fill, _ = simulate_limit(path, idx[0], 99.0, 1, pd.Timedelta(hours=2))
    assert out == "TP" and fill == idx[3]


def test_limit_sl_in_fill_bar_counts():
    n = 300
    opens = [100.0] * n
    highs = [100.1] * n
    lows = [99.9] * n
    lows[3] = 98.4  # fuellt bei 99.0 und reisst SL 98.505 in derselben Kerze
    path, idx = _path(highs, lows, opens)
    out, _, _, _ = simulate_limit(path, idx[0], 99.0, 1, pd.Timedelta(hours=2))
    assert out == "SL"


def test_limit_nofill():
    path, idx = _path([100.1] * 300, [99.9] * 300, [100.0] * 300)
    out, _, _, _ = simulate_limit(path, idx[0], 99.0, 1, pd.Timedelta(hours=2))
    assert out == "NOFILL"


def test_nearest_level_side_and_reach():
    row = np.array([98.0, 99.4, 100.8, np.nan, 103.0])
    assert nearest_level(row, 100.0, 1, 0.01) == 99.4
    assert nearest_level(row, 100.0, -1, 0.01) == 100.8
    assert nearest_level(row, 100.0, 1, 0.005) is None


def test_levels_and_secondary_signals_ignore_future_data():
    full = _frames(96 * 100, seed=3)
    cut = full["15m"].index[96 * 70]
    f15 = full["15m"][full["15m"].index < cut]
    f1h = full["1h"][full["1h"].index + pd.Timedelta(hours=1) <= cut]
    a = vwap_levels(full["15m"], full["1h"])
    b = vwap_levels(f15, f1h)
    common = b.index[b.index >= b.index[0] + pd.Timedelta(days=10)]
    pd.testing.assert_frame_equal(a.loc[common], b.loc[common])

    trunc = {"15m": f15, "1h": f1h}
    for tf, rule in (("4h", "4h"), ("1d", "1D")):
        r = full[tf]
        trunc[tf] = r[r.index + pd.Timedelta(rule) <= cut]
    sa = secondary_signals(full["15m"], radar_signals("15m", full))
    sb = secondary_signals(f15, radar_signals("15m", trunc))
    common = sb.index[sb.index >= sb.index[0] + pd.Timedelta(days=40)]
    # Geldfluss-Divergenz braucht MFD_LEN Kerzen Bestaetigung -> letzte 5 Kerzen ausnehmen
    common = common[:-5]
    pd.testing.assert_frame_equal(sa.loc[common], sb.loc[common])
