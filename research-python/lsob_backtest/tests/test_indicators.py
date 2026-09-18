import numpy as np
import pandas as pd
import pytest

from indicators import ema, macd, rsi


def test_ema_matches_manual_recursion():
    values = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
    period = 2
    result = ema(values, period)

    alpha = 2 / (period + 1)
    expected = [1.0]
    for v in values.iloc[1:]:
        expected.append((v - expected[-1]) * alpha + expected[-1])

    np.testing.assert_allclose(result.to_numpy(), expected)


def test_macd_line_is_ema_fast_minus_ema_slow():
    close = pd.Series(np.linspace(100, 150, 60))
    macd_line, signal_line, histogram = macd(close, fast=12, slow=26, signal=9)

    expected_macd_line = ema(close, 12) - ema(close, 26)
    np.testing.assert_allclose(macd_line.to_numpy(), expected_macd_line.to_numpy())
    np.testing.assert_allclose(histogram.to_numpy(), (macd_line - signal_line).to_numpy())


def test_rsi_all_gains_approaches_100():
    close = pd.Series(np.arange(1.0, 51.0))  # streng monoton steigend
    result = rsi(close, period=14)
    assert result.iloc[-1] > 99.0


def test_rsi_all_losses_approaches_0():
    close = pd.Series(np.arange(50.0, 0.0, -1.0))  # streng monoton fallend
    result = rsi(close, period=14)
    assert result.iloc[-1] < 1.0


def test_rsi_first_value_is_nan_but_not_the_rest():
    # close.diff() macht nur den allerersten Wert NaN -- pandas' ewm(...,
    # adjust=False) nimmt danach sofort den ersten gueltigen Gain/Loss als
    # Startwert, es gibt KEINE laengere NaN-Aufwaermphase (siehe indicators.py).
    close = pd.Series(np.arange(1.0, 20.0))
    result = rsi(close, period=14)
    assert pd.isna(result.iloc[0])
    assert result.iloc[1:].notna().all()
