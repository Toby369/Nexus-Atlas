import numpy as np

from pivots import pivot_high, pivot_low


def test_pivot_high_confirmed_with_delay():
    highs = np.array([1, 2, 3, 10, 3, 2, 1, 2, 3, 4, 3, 2, 1], dtype=float)
    revealed = pivot_high(highs, left=2, right=2)

    # Pivot bei Index 3 (Wert 10) wird erst bei Index 3+2=5 sichtbar.
    assert np.isnan(revealed[:5]).all()
    assert revealed[5] == 10
    assert np.isnan(revealed[6:11]).all()
    # Zweiter, kleinerer Pivot bei Index 9 (Wert 4), sichtbar bei Index 11.
    assert revealed[11] == 4


def test_pivot_low_confirmed_with_delay():
    lows = np.array([10, 9, 8, 1, 8, 9, 10, 9, 8, 7, 8, 9, 10], dtype=float)
    revealed = pivot_low(lows, left=2, right=2)

    assert np.isnan(revealed[:5]).all()
    assert revealed[5] == 1
    assert revealed[11] == 7


def test_no_pivot_on_monotonic_series():
    values = np.arange(1, 21, dtype=float)
    revealed = pivot_high(values, left=3, right=3)
    assert np.isnan(revealed).all()


def test_tie_does_not_confirm_pivot():
    highs = np.array([1, 5, 5, 1], dtype=float)
    revealed = pivot_high(highs, left=1, right=1)
    assert np.isnan(revealed).all()
