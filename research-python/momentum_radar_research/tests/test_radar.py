"""Look-Ahead- und Semantik-Tests fuer den Radar-Nachbau."""

import numpy as np
import pandas as pd

from radar import htf_on_chart, radar_signals, zone_state


def _ohlcv(freq: str, periods: int, seed: int, start: str = "2024-01-01") -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=periods, freq=freq, tz="UTC").as_unit("ns")
    close = 40000 * np.exp(np.cumsum(rng.normal(0, 0.004, periods)))
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.003, periods))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.003, periods))
    vol = rng.uniform(100, 1000, periods)
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": vol}, index=idx)


def _resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    return df.resample(rule, label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    ).dropna()


def _frames(n15: int, seed: int = 1) -> dict[str, pd.DataFrame]:
    f15 = _ohlcv("15min", n15, seed)
    return {"15m": f15, "1h": _resample(f15, "1h"), "4h": _resample(f15, "4h"), "1d": _resample(f15, "1D")}


def test_htf_value_visible_only_after_htf_close():
    htf = pd.DataFrame({"v": [1.0, 2.0, 3.0]}, index=pd.date_range("2025-01-01", periods=3, freq="4h", tz="UTC").as_unit("ns"))
    chart = pd.date_range("2025-01-01", periods=48, freq="15min", tz="UTC").as_unit("ns")
    got = htf_on_chart(chart, "15m", htf, "4h")["v"]
    # 4h-Kerze 00:00 schliesst 04:00 -> erst ab der Chart-Kerze, die um 04:00 OEFFNET.
    assert got.loc[:"2025-01-01 03:45"].isna().all()
    assert got.loc["2025-01-01 04:00"] == 1.0
    assert got.loc["2025-01-01 07:45"] == 1.0
    assert got.loc["2025-01-01 08:00"] == 2.0


def test_same_timeframe_uses_own_bar():
    htf = pd.DataFrame({"v": [1.0, 2.0]}, index=pd.date_range("2025-01-01", periods=2, freq="4h", tz="UTC").as_unit("ns"))
    got = htf_on_chart(htf.index, "4h", htf, "4h")["v"]
    assert list(got) == [1.0, 2.0]


def test_zone_state_levels():
    w = pd.Series([-60.0, -40.0, -30.0, 0.0, 30.0, 40.0, 60.0, np.nan])
    assert list(zone_state(w)) == [1, 1, 0, 0, 0, -1, -1, 0]


def test_signals_do_not_change_when_future_data_is_removed():
    """Staerkster Look-Ahead-Test: Signale auf einem abgeschnittenen Datensatz muessen
    fuer jeden gemeinsamen Zeitpunkt identisch mit denen auf dem vollen Datensatz
    sein. Die hoeheren Zeitebenen werden dafuer aus dem abgeschnittenen 15m-Satz neu
    gebildet (nur vollstaendige HTF-Kerzen), wie es live der Fall waere."""
    full = _frames(96 * 120)
    cut_at = full["15m"].index[96 * 90]
    f15 = full["15m"][full["15m"].index < cut_at]
    trunc = {"15m": f15}
    for tf, rule in (("1h", "1h"), ("4h", "4h"), ("1d", "1D")):
        r = _resample(f15, rule)
        trunc[tf] = r[r.index + pd.Timedelta(rule) <= cut_at]  # laufende HTF-Kerze weglassen
    cols = ["bull_dot", "bear_dot", "bull_big", "bear_big", "ema_dir_4h", "bos_dir_4h"]
    for tf in ("15m", "1h"):
        a = radar_signals(tf, full)[cols]
        b = radar_signals(tf, trunc)[cols]
        common = b.index[b.index >= b.index[0] + pd.Timedelta(days=40)]
        pd.testing.assert_frame_equal(a.loc[common], b.loc[common], check_dtype=False)
