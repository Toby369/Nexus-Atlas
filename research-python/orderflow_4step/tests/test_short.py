"""Short-Setup als Spiegelung (Protokoll Nachtrag 3)."""

import numpy as np
import pandas as pd
import pytest

from orderflow_4step import config as C
from orderflow_4step.signals import Dataset, _mirror_ohlc, build_setups, mirror_regime, mirrored
from orderflow_4step.simulate import COST_PER_SIDE, Bars, simulate_trade, trades_frame

NO_FUNDING = pd.Series(0.0, index=pd.date_range("2023-12-01", "2024-02-01", freq="8h", tz="UTC"))


def short_bars(rows, start="2024-01-01 01:00"):
    """rows in echten Preisen (open, high, low, close) -> gespiegelte Bars wie in der Short-Kette."""
    idx = pd.date_range(start, periods=len(rows), freq="15min", tz="UTC")
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx, dtype=float)
    df["volume"] = 1.0
    return Bars.from_frame(_mirror_ohlc(df))


def short_half(entry, exit_price):
    return (entry - exit_price) / entry - COST_PER_SIDE * (1 + exit_price / entry)


def flat(n, price=100.0):
    return [(price, price + 0.1, price - 0.1, price)] * n


def test_short_target_profit_has_positive_r():
    bars = short_bars([(100, 100.5, 99.5, 100), (100, 100, 96.5, 97)] + flat(5, 97))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=-102.0, t1=-97.0, t2=np.nan,
                           funding_fallback=-C.FUNDING_FALLBACK)
    assert trade.exit_reason == "t1_full"
    assert trade.r == pytest.approx(short_half(100, 97) / 0.02)
    assert trade.r > 0


def test_short_stop_loss_has_negative_r():
    bars = short_bars([(100, 100.5, 99.5, 100), (100, 102.5, 99, 102)] + flat(5, 102))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=-102.0, t1=-97.0, t2=np.nan)
    assert trade.exit_reason == "stop"
    assert trade.is_loss
    assert trade.r == pytest.approx(short_half(100, 102) / 0.02)


def test_short_receives_positive_funding_and_default():
    rows = [(100, 100.5, 99.5, 100)] + flat(4) + [(100, 100, 96.5, 97)] + flat(3, 97)
    bars = short_bars(rows, start="2024-01-01 07:00")
    rate = pd.Series([0.001], index=[pd.Timestamp("2024-01-01 08:00", tz="UTC")])
    trade = simulate_trade(bars, -rate, 0, stop=-102.0, t1=-97.0, t2=np.nan, funding_fallback=-C.FUNDING_FALLBACK)
    assert trade.r == pytest.approx((short_half(100, 97) + 0.001) / 0.02)
    trade_default = simulate_trade(bars, pd.Series(dtype=float), 0, stop=-102.0, t1=-97.0, t2=np.nan,
                                   funding_fallback=-C.FUNDING_FALLBACK)
    assert trade_default.r == pytest.approx((short_half(100, 97) + C.FUNDING_FALLBACK) / 0.02)


def test_trades_frame_reports_positive_prices():
    bars = short_bars([(100, 100.5, 99.5, 100), (100, 100, 96.5, 97)] + flat(5, 97))
    trade = simulate_trade(bars, NO_FUNDING, 0, stop=-102.0, t1=-97.0, t2=np.nan)
    row = trades_frame([trade]).iloc[0]
    assert (row["entry"], row["stop"], row["t1"]) == (100.0, 102.0, 97.0)


def test_mirror_regime_swaps_direction_only():
    assert mirror_regime("TREND_EXPANSION_BULLISH") == "TREND_EXPANSION_BEARISH"
    assert mirror_regime("TREND_FORMING_BEARISH") == "TREND_FORMING_BULLISH"
    assert mirror_regime("VOLA_SQUEEZE_RANGING") == "VOLA_SQUEEZE_RANGING"
    assert mirror_regime("MISSING") == "MISSING"


def _dataset_with_short_absorption():
    """Ruhiger Markt mit einer Short-Absorption (neues Hoch, starker Kaufdruck, Schluss unten)
    und einer Bestaetigung in der Folgekerze."""
    rng = np.random.default_rng(0)
    n = 400
    idx = pd.date_range("2024-01-01", periods=n, freq="15min", tz="UTC")
    close = 100 + rng.normal(0, 0.05, n)
    df = pd.DataFrame({"open": close, "high": close + 0.2, "low": close - 0.2, "close": close,
                       "volume": 100.0, "taker_buy_base_vol": 50 + rng.normal(0, 5, n)}, index=idx)
    a = 300
    df.iloc[a] = [100.0, 103.0, 99.9, 100.5, 100.0, 95.0]  # Hoch 103, Schluss unten, Kaeufer dominieren
    df.iloc[a + 1] = [100.5, 100.6, 99.5, 99.6, 100.0, 20.0]  # schliesst unter Absorptions-Tief, Verkaeufer
    df1h = df.resample("1h").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
    df4h = df.resample("4h").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
    funding = pd.Series(0.0001, index=pd.date_range("2023-11-01", periods=300, freq="8h", tz="UTC"))
    return Dataset(df, df1h, df4h, funding), a


def test_mirrored_dataset_finds_short_setup_with_stop_above_high():
    ds, a = _dataset_with_short_absorption()
    short = mirrored(ds)
    setups = build_setups(short)
    row = setups[setups["abs_pos"] == a]
    assert len(row) == 1
    assert row["conf_pos"].iloc[0] == a + 1
    expected_stop = 103.0 + C.STOP_ATR_BUFFER * ds.atr.iloc[a + 1]
    assert -row["stop"].iloc[0] == pytest.approx(expected_stop)
    # Die Long-Seite sieht hier keine Absorption
    assert a not in build_setups(ds)["abs_pos"].tolist()


def test_mirrored_location_uses_vah_and_upper_band():
    ds, a = _dataset_with_short_absorption()
    short = mirrored(ds)
    assert short.profile["val"].iloc[a] == pytest.approx(-ds.profile["vah"].iloc[a])
    assert short.vwap["vwap"].iloc[a] == pytest.approx(-ds.vwap["vwap"].iloc[a])
    # Hoch 103 liegt klar ueber VAH -> Premium (gespiegelt: loc_normal)
    row = build_setups(short).set_index("abs_pos").loc[a]
    assert bool(row["loc_normal"])
