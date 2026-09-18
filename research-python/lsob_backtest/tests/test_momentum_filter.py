import numpy as np
import pandas as pd

from lsob_engine import Signal
from momentum_filter import apply_macd_rsi_filter


def _uptrend_df(n: int = 80) -> pd.DataFrame:
    # Bewusst als numpy-Array statt pd.Series: eine Series mit eigenem
    # (Default-)Index wuerde beim DataFrame-Bau mit einem abweichenden
    # `index=` per Label statt per Position aligned -- bei komplett
    # unterschiedlichen Indizes (Integer vs. Datetime) wird daraus eine
    # Spalte voller NaN.
    idx = pd.date_range("2025-01-01", periods=n, freq="1h", tz="UTC")
    close = np.linspace(100, 200, n)
    return pd.DataFrame({"open": close, "high": close, "low": close, "close": close}, index=idx)


def _make_signal(direction: str, bar_index: int, time) -> Signal:
    return Signal(
        time=time, bar_index=bar_index, direction=direction, entry_price=100.0, sl_price=95.0,
        ob_created_time=time, ob_top=105.0, ob_bottom=95.0,
    )


def test_long_confirmed_in_sustained_uptrend():
    df = _uptrend_df()
    late_bar = len(df) - 1  # weit hinter MACD-Slow(26)+Signal(9)-Einschwingzeit
    signal = _make_signal("long", late_bar, df.index[late_bar])

    kept = apply_macd_rsi_filter(df, [signal])
    assert kept == [signal]


def test_short_rejected_in_sustained_uptrend():
    df = _uptrend_df()
    late_bar = len(df) - 1
    signal = _make_signal("short", late_bar, df.index[late_bar])

    kept = apply_macd_rsi_filter(df, [signal])
    assert kept == []


def test_short_confirmed_in_sustained_downtrend():
    df = _uptrend_df()
    df = df.iloc[::-1].reset_index(drop=True)
    df.index = pd.date_range("2025-01-01", periods=len(df), freq="1h", tz="UTC")
    late_bar = len(df) - 1
    signal = _make_signal("short", late_bar, df.index[late_bar])

    kept = apply_macd_rsi_filter(df, [signal])
    assert kept == [signal]


def test_mixed_signals_only_confirmed_ones_kept():
    df = _uptrend_df()
    late_bar = len(df) - 1
    long_signal = _make_signal("long", late_bar, df.index[late_bar])
    short_signal = _make_signal("short", late_bar, df.index[late_bar])

    kept = apply_macd_rsi_filter(df, [long_signal, short_signal])
    assert kept == [long_signal]


def test_empty_signals_returns_empty():
    df = _uptrend_df()
    assert apply_macd_rsi_filter(df, []) == []
