from __future__ import annotations

import numpy as np
import pandas as pd

from src.signals.candlestick_patterns import PATTERN_COLUMNS, detect_candlestick_patterns
from tests.lookahead_utils import assert_no_lookahead_on_truncation, make_datetime_index


def _ohlc(rows: list[dict]) -> pd.DataFrame:
    idx = make_datetime_index(len(rows), freq="h")
    return pd.DataFrame(rows, index=idx)


def _flat_row(price=100.0):
    return {"open": price, "high": price + 0.2, "low": price - 0.2, "close": price}


class TestDoji:
    def test_doji_after_uptrend_detected(self):
        rows = [_flat_row(90.0)] * 5 + [_flat_row(100.0)]  # prior_close(100)>trend_close(90) -> uptrend
        rows.append({"open": 100.0, "high": 102.0, "low": 98.0, "close": 100.1})  # body_pct=0.05
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["doji"].iloc[-1]) is True

    def test_large_body_is_not_doji(self):
        rows = [_flat_row(90.0)] * 5 + [_flat_row(100.0)]
        rows.append({"open": 95.0, "high": 102.0, "low": 94.0, "close": 101.0})  # body_pct gross
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["doji"].iloc[-1]) is False


class TestHammerAndHangingMan:
    def test_hammer_after_downtrend(self):
        rows = [_flat_row(110.0)] * 5 + [_flat_row(100.0)]  # prior_close(100)<trend_close(110) -> downtrend
        # body_pct = |101-100|/10 = 0.10 <=0.30, lower_wick=(100-90)/10=1.0 >=0.50
        rows.append({"open": 100.0, "high": 101.0, "low": 90.0, "close": 101.0 - 1e-9})
        rows[-1] = {"open": 100.0, "high": 101.0, "low": 90.0, "close": 101.0}
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["hammer"].iloc[-1]) is True
        assert bool(result["hanging_man"].iloc[-1]) is False

    def test_hanging_man_after_uptrend(self):
        rows = [_flat_row(90.0)] * 5 + [_flat_row(100.0)]  # uptrend
        rows.append({"open": 100.0, "high": 101.0, "low": 90.0, "close": 101.0})
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["hanging_man"].iloc[-1]) is True
        assert bool(result["hammer"].iloc[-1]) is False


class TestEngulfing:
    def test_bullish_engulfing(self):
        rows = [_flat_row(100.0)] * 4
        rows.append({"open": 100.0, "high": 100.5, "low": 97.0, "close": 97.5})  # baerische Vorkerze
        rows.append({"open": 97.0, "high": 101.5, "low": 96.5, "close": 101.0})  # umschliesst Vorkerze-Body
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["bullish_engulfing"].iloc[-1]) is True
        assert bool(result["bearish_engulfing"].iloc[-1]) is False

    def test_bearish_engulfing(self):
        rows = [_flat_row(100.0)] * 4
        rows.append({"open": 97.5, "high": 100.5, "low": 97.0, "close": 100.0})  # bullische Vorkerze
        rows.append({"open": 101.0, "high": 101.5, "low": 96.5, "close": 97.0})  # umschliesst
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["bearish_engulfing"].iloc[-1]) is True
        assert bool(result["bullish_engulfing"].iloc[-1]) is False

    def test_non_engulfing_body_does_not_trigger(self):
        rows = [_flat_row(100.0)] * 4
        rows.append({"open": 99.0, "high": 100.5, "low": 97.0, "close": 97.5})
        rows.append({"open": 98.0, "high": 99.0, "low": 97.8, "close": 98.8})  # zu klein, umschliesst nicht
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["bullish_engulfing"].iloc[-1]) is False


class TestStars:
    def test_morning_star(self):
        rows = [_flat_row(100.0)] * 3
        # Kerze1: baerisch, body_pct=1.0 (>=0.50)
        rows.append({"open": 100.0, "high": 100.2, "low": 89.8, "close": 90.0})
        # Kerze2 (Star): kleiner Body, body_pct=0.1 (<=0.30)
        rows.append({"open": 89.0, "high": 90.0, "low": 88.0, "close": 88.8})
        # Kerze3: bullisch, body_pct gross, schliesst ueber Midpoint von Kerze1 ((100+90)/2=95)
        rows.append({"open": 89.0, "high": 97.5, "low": 88.5, "close": 97.0})
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["morning_star"].iloc[-1]) is True
        assert bool(result["evening_star"].iloc[-1]) is False

    def test_evening_star(self):
        rows = [_flat_row(100.0)] * 3
        # Kerze1: bullisch
        rows.append({"open": 90.0, "high": 100.2, "low": 89.8, "close": 100.0})
        # Kerze2 (Star): kleiner Body, body_pct=0.2/1.7=0.12 (<=0.30)
        rows.append({"open": 100.5, "high": 101.5, "low": 99.8, "close": 100.7})
        # Kerze3: baerisch, schliesst unter Midpoint von Kerze1 ((90+100)/2=95)
        rows.append({"open": 101.0, "high": 101.5, "low": 92.0, "close": 93.0})
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["evening_star"].iloc[-1]) is True
        assert bool(result["morning_star"].iloc[-1]) is False

    def test_star_with_large_middle_body_not_detected(self):
        rows = [_flat_row(100.0)] * 3
        rows.append({"open": 100.0, "high": 100.2, "low": 89.8, "close": 90.0})
        rows.append({"open": 89.0, "high": 97.0, "low": 88.0, "close": 96.0})  # grosser Body -> kein Star
        rows.append({"open": 96.0, "high": 98.0, "low": 95.5, "close": 97.5})
        result = detect_candlestick_patterns(_ohlc(rows))
        assert bool(result["morning_star"].iloc[-1]) is False


class TestOutputProperties:
    def test_all_columns_present_and_boolean(self):
        rng = np.random.default_rng(4)
        n = 60
        walk = 100 + np.cumsum(rng.normal(0, 1.0, n))
        ohlc = pd.DataFrame(
            {"open": walk, "high": walk + 1.0, "low": walk - 1.0, "close": walk},
            index=make_datetime_index(n, freq="h"),
        )
        result = detect_candlestick_patterns(ohlc)
        for col in PATTERN_COLUMNS:
            assert col in result.columns
            assert result[col].dtype == bool
            assert result[col].notna().all()


class TestNoLookahead:
    def test_truncation_reproduces_historical_labels(self):
        rng = np.random.default_rng(21)
        n = 100
        walk = 100 + np.cumsum(rng.normal(0, 1.0, n))
        ohlc = pd.DataFrame(
            {"open": walk, "high": walk + 1.0, "low": walk - 1.0, "close": walk},
            index=make_datetime_index(n, freq="h"),
        )
        assert_no_lookahead_on_truncation(detect_candlestick_patterns, ohlc, cutoff_pos=70)
